import type { Request, Response, NextFunction } from 'express';
import { verifyApiKey } from './key-generator.js';

export interface Agent {
  id: string;
  name: string;
  api_key_hash: string;
  status: string;
  created_at: string;
}

export function createApiKeyAuth(
  getActiveAgents: () => Promise<Agent[]>
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const apiKey = authHeader.slice(7);
    if (!apiKey.startsWith('cmem_ak_')) {
      res.status(401).json({ error: 'Invalid API key format' });
      return;
    }

    try {
      const agents = await getActiveAgents();
      for (const agent of agents) {
        if (await verifyApiKey(apiKey, agent.api_key_hash)) {
          (req as any).agent = agent;
          next();
          return;
        }
      }

      res.status(401).json({ error: 'Invalid API key' });
    } catch (error) {
      res.status(500).json({ error: 'Authentication error' });
    }
  };
}
