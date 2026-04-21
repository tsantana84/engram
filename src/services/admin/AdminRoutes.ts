import express from 'express';
import type { Request, Response } from 'express';
import { BaseRouteHandler } from '../worker/http/BaseRouteHandler.js';
import type { ErrorStore } from './ErrorStore.js';
import type { HealthChecker } from './HealthChecker.js';

interface AdminDeps {
  queue: {
    getStatus(): { pending: number; synced: number; failed: number; permanently_failed: number };
    getFailedItems(limit: number): Array<{ id: number; type: string; retries: number; lastError: string | null }>;
  } | null;
  syncWorker: { getExtractionStats(): unknown } | null;
  healthChecker: HealthChecker;
  errorStore: ErrorStore;
}

export class AdminRoutes extends BaseRouteHandler {
  constructor(private deps: AdminDeps) {
    super();
  }

  setupRoutes(app: express.Application): void {
    app.get('/api/admin', this.handle.bind(this));
  }

  private async handle(_req: Request, res: Response): Promise<void> {
    const [health, errors] = await Promise.all([
      this.deps.healthChecker.check().catch(() => null),
      Promise.resolve(this.deps.errorStore.getAll()),
    ]);

    const syncQueue = this.getSyncQueue();
    const extraction = this.deps.syncWorker?.getExtractionStats() ?? null;

    res.json({ syncQueue, extraction, health, errors, fetchedAt: new Date().toISOString() });
  }

  private getSyncQueue() {
    if (!this.deps.queue) return null;
    try {
      const status = this.deps.queue.getStatus();
      const failedItems = this.deps.queue.getFailedItems(10);
      return { ...status, failedItems };
    } catch {
      return null;
    }
  }
}
