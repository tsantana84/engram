import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initSupabase } from './lib/SupabaseManager.js';
import { authenticateRequest } from './auth.js';

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

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
    const { q, project, type, agent, limit, offset } = req.query || {};

    const results = await db.searchObservations(q as string || '', {
      project: project as string,
      type: type as string,
      agent: agent as string,
      limit: limit ? parseInt(limit as string) : 20,
      offset: offset ? parseInt(offset as string) : 0,
    });

    res.status(200).json({ results, count: results.length });
  } catch (err: any) {
    res.status(500).json({ error: 'Search failed', detail: err?.message });
  }
}
