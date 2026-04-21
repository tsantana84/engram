import { describe, it, expect, mock } from 'bun:test';
import { AdminRoutes } from './AdminRoutes';
import { ErrorStore } from './ErrorStore';

describe('GET /api/admin', () => {
  it('returns aggregated admin data', async () => {
    const mockQueue = {
      getStatus: mock(async () => ({ pending: 2, failed: 1, synced: 10, permanently_failed: 0 })),
      getFailedItems: mock(async () => [{ id: 1, type: 'observation', retries: 2, lastError: 'timeout' }]),
    };
    const mockWorker = {
      getExtractionStats: mock(() => ({ enabled: true, threshold: 0.9, lastRunAt: null, lastRunStats: null })),
    };
    const mockHealth = {
      check: mock(async () => ({ uptimeSeconds: 100, chroma: 'ok', syncServer: 'ok', workerVersion: '1.0.0' })),
    };
    const errorStore = new ErrorStore(5);

    const routes = new AdminRoutes({
      queue: mockQueue,
      syncWorker: mockWorker,
      healthChecker: mockHealth as any,
      errorStore,
    });

    const mockReq = {};
    const mockRes = { json: mock((data: any) => data) };

    await (routes as any).handle(mockReq, mockRes);

    expect(mockRes.json).toHaveBeenCalledTimes(1);
    const result = mockRes.json.mock.calls[0][0];

    expect(result.syncQueue.pending).toBe(2);
    expect(result.syncQueue.failed).toBe(1);
    expect(result.syncQueue.failedItems).toHaveLength(1);
    expect(result.syncQueue.failedItems[0].id).toBe(1);
    expect(result.extraction.enabled).toBe(true);
    expect(result.health.chroma).toBe('ok');
    expect(result.health.uptimeSeconds).toBe(100);
    expect(result.errors).toBeInstanceOf(Array);
    expect(result.fetchedAt).toBeTypeOf('string');
  });

  it('returns null syncQueue on queue failure', async () => {
    const mockQueue = {
      getStatus: mock(async () => { throw new Error('db error'); }),
      getFailedItems: mock(async () => []),
    };
    const mockHealth = {
      check: mock(async () => ({ uptimeSeconds: 0, chroma: 'unavailable', syncServer: 'unavailable', workerVersion: '1.0.0' })),
    };
    const errorStore = new ErrorStore(5);

    const routes = new AdminRoutes({
      queue: mockQueue,
      syncWorker: null,
      healthChecker: mockHealth as any,
      errorStore,
    });

    const mockReq = {};
    const mockRes = { json: mock((data: any) => data) };

    await (routes as any).handle(mockReq, mockRes);

    const result = mockRes.json.mock.calls[0][0];
    expect(result.syncQueue).toBeNull();
    expect(result.extraction).toBeNull();
  });

  it('returns null health when healthChecker throws', async () => {
    const mockQueue = {
      getStatus: mock(async () => ({ pending: 0, failed: 0 })),
      getFailedItems: mock(async () => []),
    };
    const mockHealth = {
      check: mock(async () => { throw new Error('health check failed'); }),
    };
    const errorStore = new ErrorStore(5);

    const routes = new AdminRoutes({
      queue: mockQueue,
      syncWorker: null,
      healthChecker: mockHealth as any,
      errorStore,
    });

    const mockReq = {};
    const mockRes = { json: mock((data: any) => data) };

    await (routes as any).handle(mockReq, mockRes);

    const result = mockRes.json.mock.calls[0][0];
    expect(result.health).toBeNull();
  });

  it('includes errors from ErrorStore', async () => {
    const mockQueue = {
      getStatus: mock(async () => ({ pending: 0, failed: 0 })),
      getFailedItems: mock(async () => []),
    };
    const mockHealth = {
      check: mock(async () => ({ uptimeSeconds: 10, chroma: 'ok', syncServer: 'ok', workerVersion: '1.0.0' })),
    };
    const errorStore = new ErrorStore(5);
    errorStore.push({ level: 'error', message: 'something broke', ts: new Date().toISOString() });

    const routes = new AdminRoutes({
      queue: mockQueue,
      syncWorker: null,
      healthChecker: mockHealth as any,
      errorStore,
    });

    const mockReq = {};
    const mockRes = { json: mock((data: any) => data) };

    await (routes as any).handle(mockReq, mockRes);

    const result = mockRes.json.mock.calls[0][0];
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe('something broke');
  });

  it('registers GET /api/admin on the router', () => {
    const errorStore = new ErrorStore(5);
    const mockQueue = {
      getStatus: mock(async () => ({ pending: 0, failed: 0 })),
      getFailedItems: mock(async () => []),
    };
    const mockHealth = { check: mock(async () => ({ uptimeSeconds: 0, chroma: 'ok', syncServer: 'ok', workerVersion: '1.0.0' })) };

    const routes = new AdminRoutes({
      queue: mockQueue,
      syncWorker: null,
      healthChecker: mockHealth as any,
      errorStore,
    });

    // Router should have a stack with the /api/admin route registered
    const stack = (routes.router as any).stack as Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    const adminRoute = stack.find(layer => layer.route?.path === '/api/admin');
    expect(adminRoute).toBeDefined();
    expect(adminRoute?.route?.methods.get).toBe(true);
  });
});
