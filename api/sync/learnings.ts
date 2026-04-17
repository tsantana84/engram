import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initSupabase } from '../lib/SupabaseManager.js';
import { authenticateRequest } from '../auth.js';
import { ServerConflictDetector } from '../lib/ConflictDetector.js';
import { getLlmClosure } from '../lib/llm.js';
import type { LearningPushRequest, LearningPushResponse, LearningPushResult } from '../../src/services/sync/learning-types.js';

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const auth = await authenticateRequest(req);
  if (!auth) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const body = req.body as LearningPushRequest;
  if (!body || !Array.isArray(body.learnings) || !['approved', 'pending'].includes(body.target_status)) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_ANON_KEY!;
  const db = await initSupabase(supabaseUrl, supabaseKey);

  const detector = new ServerConflictDetector({
    enabled: body.target_status === 'approved',
    llm: getLlmClosure(),
    fetchSimilar: (item) => db.fetchSimilarLearnings(item.title ?? '', 5),
  });

  const results: LearningPushResult[] = [];

  for (const learning of body.learnings) {
    try {
      let targetId: number | null = null;
      let action: LearningPushResult['action'] = 'inserted';

      if (body.target_status === 'approved') {
        const decision = await detector.check({ title: learning.claim, narrative: learning.evidence });
        if (decision.decision === 'NOOP') {
          results.push({ content_hash: learning.content_hash, action: 'dedupe_noop' });
          continue;
        }
        if ((decision.decision === 'UPDATE' || decision.decision === 'INVALIDATE') && decision.targetId) {
          targetId = decision.targetId;
          action = decision.decision === 'UPDATE' ? 'updated_target' : 'invalidated_target';
        }
      }

      const ins = await db.insertLearning(
        { ...learning, source_agent_id: auth.agentId },
        body.target_status
      );

      if (targetId && ins.id) {
        await db.invalidateLearning(targetId, ins.id);
      }

      if (ins.action === 'dedupe_noop') {
        results.push({ content_hash: learning.content_hash, action: 'dedupe_noop' });
      } else if (ins.id !== undefined) {
        results.push({ content_hash: learning.content_hash, id: ins.id, action });
      } else {
        results.push({ content_hash: learning.content_hash, action: 'dedupe_noop' });
      }
    } catch (err: any) {
      results.push({ content_hash: learning.content_hash, action: 'inserted', error: err?.message ?? 'unknown' });
    }
  }

  const response: LearningPushResponse = { results };
  res.status(200).json(response);
}
