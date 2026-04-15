import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initSupabase } from '../../../services/server/SupabaseManager.js';
import { authenticateRequest } from '../auth.js';

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

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      res.status(500).json({ error: 'SUPABASE_URL or SUPABASE_ANON_KEY not configured' });
      return;
    }

    const db = await initSupabase(supabaseUrl, supabaseKey);
    const { observations = [], sessions = [], summaries = [] } = req.body || {};

    let accepted = 0;
    let duplicates = 0;
    const errors: string[] = [];

    for (const obs of observations) {
      try {
        const result = await db.insertObservation({ ...obs, agent_id: auth.agentId });
        if (result.inserted) accepted++;
        else duplicates++;
      } catch (err: any) {
        errors.push(`observation ${obs.local_id}: ${err.message}`);
      }
    }

    for (const session of sessions) {
      try {
        await db.insertSession({ ...session, agent_id: auth.agentId });
        accepted++;
      } catch (err: any) {
        errors.push(`session ${session.local_session_id}: ${err.message}`);
      }
    }

    for (const summary of summaries) {
      try {
        await db.insertSummary({ ...summary, agent_id: auth.agentId });
        accepted++;
      } catch (err: any) {
        errors.push(`summary ${summary.local_summary_id}: ${err.message}`);
      }
    }

    res.status(200).json({ accepted, duplicates, errors });
  } catch (err: any) {
    res.status(500).json({ error: 'Sync failed', detail: err?.message });
  }
}
