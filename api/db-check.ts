import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initSupabase } from './lib/SupabaseManager.js';

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      res.status(500).json({ error: 'SUPABASE_URL or SUPABASE_ANON_KEY not configured' });
      return;
    }

    await initSupabase(supabaseUrl, supabaseKey);
    res.status(200).json({ status: 'connected', timestamp: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: 'Database connection failed', detail: err?.message });
  }
}
