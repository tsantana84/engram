import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initSupabase } from '../lib/SupabaseManager.js';
import { authenticateRequest } from '../auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
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

  const db = await initSupabase(supabaseUrl, supabaseKey);
  const row = await db.getLearning(id);
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.status(200).json({ learning: row });
}
