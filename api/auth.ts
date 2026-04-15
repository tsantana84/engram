import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyApiKey } from './lib/key-generator.js';
import { getSupabaseInstance } from './lib/SupabaseManager.js';

export interface AuthResult {
  agentId: string;
  agentName: string;
}

export async function authenticateRequest(req: VercelRequest): Promise<AuthResult | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const apiKey = authHeader.slice(7);
  if (!apiKey.startsWith('cmem_ak_')) return null;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

  const db = getSupabaseInstance(supabaseUrl, supabaseKey);
  const agents = await db.getActiveAgents();
  for (const agent of agents) {
    if (await verifyApiKey(apiKey, agent.api_key_hash)) {
      return { agentId: agent.id, agentName: agent.name };
    }
  }
  return null;
}

export function withAuth(
  handler: (req: VercelRequest, res: VercelResponse, auth: AuthResult) => Promise<void>
) {
  return async (req: VercelRequest, res: VercelResponse) => {
    const auth = await authenticateRequest(req);
    if (!auth) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    return handler(req, res, auth);
  };
}
