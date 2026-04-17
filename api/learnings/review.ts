import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initSupabase } from '../lib/SupabaseManager.js';
import { authenticateRequest } from '../auth.js';
import { ServerConflictDetector } from '../lib/ConflictDetector.js';
import { getLlmClosure } from '../lib/llm.js';
import type { LearningReviewAction, LearningRecord } from '../../src/services/sync/learning-types.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const auth = await authenticateRequest(req);
  if (!auth) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const id = parseInt(req.query.id as string, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    res.status(500).json({ error: 'SUPABASE_URL or SUPABASE_ANON_KEY not configured' });
    return;
  }

  const body = req.body as LearningReviewAction;
  const db = await initSupabase(supabaseUrl, supabaseKey);
  const existing = await db.getLearning(id);
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

  if (body.action === 'reject') {
    const updated = await db.reviewLearning(id, {
      status: 'rejected',
      reviewed_by: auth.agentId,
      rejection_reason: body.rejection_reason,
    });
    res.status(200).json({ learning: updated });
    return;
  }

  // approve / edit_approve
  let effective: LearningRecord = existing;
  let editDiff: Record<string, unknown> | null = null;
  if (body.action === 'edit_approve') {
    editDiff = {
      before: { claim: existing.claim, evidence: existing.evidence, scope: existing.scope },
      after: body.edited,
    };
    effective = { ...existing, ...body.edited } as LearningRecord;
  }

  const detector = new ServerConflictDetector({
    enabled: true,
    llm: getLlmClosure(),
    // fetchSimilar receives { title, narrative } where title holds the claim text
    // we set below. db.fetchSimilarLearnings searches by claim.
    fetchSimilar: (item: { title?: string | null }) => db.fetchSimilarLearnings(item.title ?? '', 5),
  });
  const decision = await detector.check({ title: effective.claim, narrative: effective.evidence ?? null });

  if (decision.decision === 'NOOP') {
    const updated = await db.reviewLearning(id, {
      status: 'rejected',
      reviewed_by: auth.agentId,
      rejection_reason: 'dedupe_noop: detector judged duplicate',
      edit_diff: editDiff ?? undefined,
    });
    res.status(200).json({ learning: updated, decision });
    return;
  }

  const updated = await db.reviewLearning(id, {
    status: 'approved',
    reviewed_by: auth.agentId,
    edit_diff: editDiff ?? undefined,
    edited: body.action === 'edit_approve' ? body.edited : undefined,
  });

  if ((decision.decision === 'UPDATE' || decision.decision === 'INVALIDATE') && decision.targetId) {
    await db.invalidateLearning(decision.targetId, updated.id);
  }

  res.status(200).json({ learning: updated, decision });
}
