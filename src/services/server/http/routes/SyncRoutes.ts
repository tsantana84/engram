import type { Request, Response, Application } from 'express';
import type { PostgresManager } from '../../PostgresManager.js';

export class SyncRoutes {
  constructor(private pg: PostgresManager) {}

  setupRoutes(app: Application): void {
    app.post('/api/sync/push', this.handlePush.bind(this));
    app.get('/api/sync/status', this.handleStatus.bind(this));
  }

  private async handlePush(req: Request, res: Response): Promise<void> {
    try {
      const agent = (req as any).agent;
      if (!agent) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const { observations = [], sessions = [], summaries = [] } = req.body;
      let accepted = 0;
      let duplicates = 0;
      const errors: string[] = [];

      for (const obs of observations) {
        try {
          const result = await this.pg.insertObservation({
            ...obs,
            agent_id: agent.id,
          });
          if (result.inserted) accepted++;
          else duplicates++;
        } catch (err: any) {
          errors.push(`observation ${obs.local_id}: ${err.message}`);
        }
      }

      for (const session of sessions) {
        try {
          await this.pg.insertSession({
            ...session,
            agent_id: agent.id,
          });
          accepted++;
        } catch (err: any) {
          errors.push(`session ${session.local_session_id}: ${err.message}`);
        }
      }

      for (const summary of summaries) {
        try {
          await this.pg.insertSummary({
            ...summary,
            agent_id: agent.id,
          });
          accepted++;
        } catch (err: any) {
          errors.push(`summary ${summary.local_summary_id}: ${err.message}`);
        }
      }

      res.json({ accepted, duplicates, errors });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  private async handleStatus(req: Request, res: Response): Promise<void> {
    try {
      const agent = (req as any).agent;
      if (!agent) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const status = await this.pg.getAgentSyncStatus(agent.id);
      res.json({
        agent_name: agent.name,
        ...status,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
