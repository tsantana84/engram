/**
 * Graph Routes
 *
 * Handles GET /api/graph — traverses the knowledge graph from a given entity.
 */

import type { Application, Request, Response } from 'express';
import type { DatabaseManager } from '../../DatabaseManager.js';
import { GraphStore } from '../../../sqlite/graph/GraphStore.js';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { logger } from '../../../../utils/logger.js';

export class GraphRoutes extends BaseRouteHandler {
  constructor(private readonly dbManager: DatabaseManager) {
    super();
  }

  setupRoutes(app: Application): void {
    app.get('/api/graph', this.wrapHandler(this.handleGraph.bind(this)));
  }

  private handleGraph(req: Request, res: Response): void {
    const entity = req.query['entity'] as string | undefined;
    const type = req.query['type'] as string | undefined;
    const depthStr = req.query['depth'] as string | undefined;

    if (!entity || !type) {
      res.status(400).json({ error: 'entity and type are required' });
      return;
    }

    const validTypes = ['observation', 'file', 'concept', 'session'];
    if (!validTypes.includes(type)) {
      res.status(400).json({ error: 'type must be one of: ' + validTypes.join(', ') });
      return;
    }

    const depth = Math.min(Math.max(parseInt(depthStr || '2', 10) || 2, 1), 3);
    logger.debug('GRAPH', 'Traversing graph', { entity, type, depth });
    const sessionStore = this.dbManager.getSessionStore();
    const graph = new GraphStore(sessionStore.db);
    const result = graph.traverse({ type, id: entity }, depth);

    res.json(result);
  }
}
