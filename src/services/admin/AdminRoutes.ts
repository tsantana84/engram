import { Router } from 'express';
import type { ErrorStore } from './ErrorStore';
import type { HealthChecker } from './HealthChecker';

interface AdminDeps {
  queue: {
    getStatus(): Promise<{ pending: number; failed: number }>;
    getFailedItems(limit: number): Promise<Array<{ id: number; type: string; retries: number; lastError: string | null }>>;
  };
  syncWorker: { getExtractionStats(): unknown } | null;
  healthChecker: HealthChecker;
  errorStore: ErrorStore;
}

export class AdminRoutes {
  readonly router = Router();

  constructor(private deps: AdminDeps) {
    this.router.get('/api/admin', this.handle.bind(this));
  }

  private async handle(req: any, res: any): Promise<void> {
    const [syncQueue, health, errors] = await Promise.all([
      this.getSyncQueue(),
      this.deps.healthChecker.check().catch(() => null),
      Promise.resolve(this.deps.errorStore.getAll()),
    ]);

    const extraction = this.deps.syncWorker?.getExtractionStats() ?? null;

    res.json({ syncQueue, extraction, health, errors, fetchedAt: new Date().toISOString() });
  }

  private async getSyncQueue() {
    try {
      const [status, failedItems] = await Promise.all([
        this.deps.queue.getStatus(),
        this.deps.queue.getFailedItems(10),
      ]);
      return { ...status, failedItems };
    } catch {
      return null;
    }
  }
}
