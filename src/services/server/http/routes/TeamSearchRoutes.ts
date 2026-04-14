import type { Request, Response, Application } from 'express';
import type { PostgresManager } from '../../PostgresManager.js';

export class TeamSearchRoutes {
  constructor(private pg: PostgresManager) {}

  setupRoutes(app: Application): void {
    app.get('/api/search', this.handleSearch.bind(this));
    app.get('/api/timeline', this.handleTimeline.bind(this));
  }

  private async handleSearch(req: Request, res: Response): Promise<void> {
    try {
      const query = (req.query.query as string) || '';
      const limit = parseInt((req.query.limit as string) || '20');
      const offset = parseInt((req.query.offset as string) || '0');
      const project = req.query.project as string | undefined;
      const type = req.query.type as string | undefined;
      const agent = req.query.agent as string | undefined;

      const results = await this.pg.searchObservations(query, {
        limit, offset, project, type, agent,
      });

      res.json({ observations: results, count: results.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  private async handleTimeline(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt((req.query.limit as string) || '50');
      const offset = parseInt((req.query.offset as string) || '0');
      const project = req.query.project as string | undefined;
      const agent = req.query.agent as string | undefined;

      const results = await this.pg.getTimeline({
        limit, offset, project, agent,
      });

      res.json({ timeline: results, count: results.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
