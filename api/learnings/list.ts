import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initSupabase } from '../lib/SupabaseManager.js';
import { authenticateRequest } from '../auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const auth = await authenticateRequest(req);
  if (!auth) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const status = (req.query.status as string | undefined) as any;
  const project = req.query.project as string | undefined;
  const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10) || 50, 200);
  const offset = parseInt((req.query.offset as string) ?? '0', 10) || 0;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    res.status(500).json({ error: 'SUPABASE_URL or SUPABASE_ANON_KEY not configured' });
    return;
  }

  const db = await initSupabase(supabaseUrl, supabaseKey);
  const rows = await db.listLearnings({ status, project, limit, offset });
  res.status(200).json({ learnings: rows });
}
