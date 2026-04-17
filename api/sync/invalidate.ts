import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initSupabase } from '../lib/SupabaseManager.js';
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

  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'ids array required' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    res.status(500).json({ error: 'SUPABASE_URL or SUPABASE_ANON_KEY not configured' });
    return;
  }

  try {
    const db = await initSupabase(supabaseUrl, supabaseKey);
    await db.invalidateObservations(ids as number[], auth.agentId);
    res.status(200).json({ invalidated: ids.length });
  } catch (err: any) {
    res.status(500).json({ error: 'Invalidation failed', detail: err?.message });
  }
}
