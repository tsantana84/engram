import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initSupabase } from '../../services/server/SupabaseManager.js';
import { generateApiKey, hashApiKey } from '../../services/server/auth/key-generator.js';

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

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
    const existing = await db.getAgentByName(name);
    if (existing) {
      res.status(409).json({ error: 'Agent already exists' });
      return;
    }

    const apiKey = generateApiKey();
    const apiKeyHash = await hashApiKey(apiKey);
    const agent = await db.createAgent(name, apiKeyHash);

    res.status(201).json({
      agent: { id: agent.id, name: agent.name, status: agent.status, created_at: agent.created_at },
      api_key: apiKey,
      warning: 'Store this API key securely — it cannot be retrieved later.',
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create agent', detail: err?.message });
  }
}
