/**
 * Correction Routes
 *
 * Handles storing correction journal entries.
 * POST /api/corrections - Store a correction with dual-write to corrections table + observations
 */

import express, { Request, Response } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { logger } from '../../../../utils/logger.js';
import type { DatabaseManager } from '../../DatabaseManager.js';

export class CorrectionRoutes extends BaseRouteHandler {
  constructor(private dbManager: DatabaseManager) {
    super();
  }

  setupRoutes(app: express.Application): void {
    app.post('/api/corrections', this.handleStoreCorrection.bind(this));
  }

  /**
   * POST /api/corrections - Store a correction journal entry
   * Body: { tried: string, wrong_because: string, fix: string, trigger_context: string, session_id?: string, project?: string }
   */
  private handleStoreCorrection = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const { tried, wrong_because, fix, trigger_context, session_id, project } = req.body;

    if (!tried || !wrong_because || !fix || !trigger_context) {
      this.badRequest(res, 'tried, wrong_because, fix, trigger_context are required');
      return;
    }
    if (typeof trigger_context !== 'string' || !trigger_context.trim()) {
      this.badRequest(res, 'trigger_context must be non-empty');
      return;
    }

    const store = this.dbManager.getSessionStore();
    const targetProject = project ?? '';

    // Atomic dual-write: corrections table + observations table
    const write = store.db.transaction(() => {
      store.db.prepare(`
        INSERT INTO corrections (tried, wrong_because, fix, trigger_context, session_id, project, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(tried, wrong_because, fix, trigger_context, session_id ?? null, project ?? null, Date.now());

      const memorySessionId = session_id ?? store.getOrCreateManualSession(targetProject);

      return store.storeObservation(
        memorySessionId,
        targetProject,
        {
          type: 'discovery',
          title: `Correction: ${tried.slice(0, 60)}`,
          subtitle: `Fix: ${fix.slice(0, 60)}`,
          facts: [wrong_because],
          narrative: `Tried: ${tried}. Wrong because: ${wrong_because}. Fix: ${fix}. Context: ${trigger_context}`,
          concepts: ['correction', trigger_context],
          files_read: [],
          files_modified: [],
        },
        0,
        0
      );
    });

    const result = write();
    logger.info('CORRECTION', 'Stored correction', { id: result.id, trigger_context });

    res.json({ success: true, id: result.id });
  });
}
