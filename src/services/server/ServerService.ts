import express from 'express';
import { PostgresManager } from './PostgresManager.js';
import { createApiKeyAuth } from './auth/ApiKeyAuth.js';
import { SyncRoutes } from './http/routes/SyncRoutes.js';
import { AgentRoutes } from './http/routes/AgentRoutes.js';
import { TeamSearchRoutes } from './http/routes/TeamSearchRoutes.js';

export interface ServerConfig {
  port: number;
  databaseUrl: string;
}

export class ServerService {
  private app: express.Application;
  private pg: PostgresManager;
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
    this.app = express();
    this.pg = new PostgresManager(config.databaseUrl);
  }

  async start(): Promise<void> {
    await this.pg.connect();
    await this.pg.runMigrations();

    this.app.use(express.json({ limit: '10mb' }));

    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', version: '1.0.0' });
    });

    const authMiddleware = createApiKeyAuth(() => this.pg.getActiveAgents());
    this.app.use('/api/sync', authMiddleware);
    this.app.use('/api/search', authMiddleware);
    this.app.use('/api/timeline', authMiddleware);

    new SyncRoutes(this.pg).setupRoutes(this.app);
    new AgentRoutes(this.pg).setupRoutes(this.app);
    new TeamSearchRoutes(this.pg).setupRoutes(this.app);

    return new Promise((resolve) => {
      this.app.listen(this.config.port, () => {
        console.log(`Engram sync server listening on port ${this.config.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await this.pg.close();
  }

  getPostgresManager(): PostgresManager {
    return this.pg;
  }
}
