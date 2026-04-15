import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initSupabase } from '../../services/server/SupabaseManager.js';

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      res.status(500).json({ error: 'SUPABASE_URL or SUPABASE_ANON_KEY not configured' });
      return;
    }

    const db = await initSupabase(supabaseUrl, supabaseKey);
    const agents = await db.getActiveAgents();
    res.status(200).json({ agents });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list agents', detail: err?.message });
  }
}
