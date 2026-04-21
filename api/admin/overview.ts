import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticateRequest } from '../auth';
import { getSupabaseInstance } from '../lib/SupabaseManager';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();

  const agent = await authenticateRequest(req);
  if (!agent) return res.status(401).json({ error: 'Invalid or missing token' });

  const db = getSupabaseInstance(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

  const [agents, syncHealth, learningQuality] = await Promise.allSettled([
    db.getAgentActivity(),
    db.getSyncHealth(),
    db.getLearningQuality(),
  ]);

  res.json({
    agents: agents.status === 'fulfilled' ? agents.value : null,
    syncHealth: syncHealth.status === 'fulfilled' ? syncHealth.value : null,
    learningQuality: learningQuality.status === 'fulfilled' ? learningQuality.value : null,
    fetchedAt: new Date().toISOString(),
  });
}
