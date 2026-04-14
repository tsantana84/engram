import type { Request, Response, Application } from 'express';
import type { PostgresManager } from '../../PostgresManager.js';
import { generateApiKey, hashApiKey } from '../../auth/key-generator.js';

export class AgentRoutes {
  constructor(private pg: PostgresManager) {}

  setupRoutes(app: Application): void {
    app.get('/api/agents', this.handleList.bind(this));
    app.post('/api/agents', this.handleCreate.bind(this));
    app.post('/api/agents/:name/revoke', this.handleRevoke.bind(this));
  }

  private async handleList(req: Request, res: Response): Promise<void> {
    try {
      const agents = await this.pg.getActiveAgents();
      res.json({
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          status: a.status,
          created_at: a.created_at,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  private async handleCreate(req: Request, res: Response): Promise<void> {
    try {
      const { name } = req.body;
      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'name is required' });
        return;
      }

      const apiKey = generateApiKey();
      const hash = await hashApiKey(apiKey);

      const agent = await this.pg.createAgent(name.trim(), hash);

      res.status(201).json({
        id: agent.id,
        name: agent.name,
        api_key: apiKey,
        message: 'Save this API key — it cannot be retrieved again.',
      });
    } catch (error: any) {
      if (error.code === '23505') {
        res.status(409).json({ error: `Agent "${req.body.name}" already exists` });
        return;
      }
      res.status(500).json({ error: error.message });
    }
  }

  private async handleRevoke(req: Request, res: Response): Promise<void> {
    try {
      const { name } = req.params;
      const agent = await this.pg.getAgentByName(name);
      if (!agent) {
        res.status(404).json({ error: `Agent "${name}" not found` });
        return;
      }

      await this.pg.revokeAgent(name);
      res.json({ message: `Agent "${name}" revoked` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
