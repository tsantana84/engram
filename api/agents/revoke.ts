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

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      res.status(500).json({ error: 'SUPABASE_URL or SUPABASE_ANON_KEY not configured' });
      return;
    }

    const { name } = req.body || {};
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Missing or invalid "name" field' });
      return;
    }

    const db = await initSupabase(supabaseUrl, supabaseKey);
    await db.revokeAgent(name);
    res.status(200).json({ revoked: true, name });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to revoke agent', detail: err?.message });
  }
}
