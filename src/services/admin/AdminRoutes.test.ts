import { describe, it, expect, mock } from 'bun:test';
import { AdminRoutes } from './AdminRoutes';
import { ErrorStore } from './ErrorStore';

describe('GET /api/admin', () => {
  it('returns aggregated admin data', async () => {
    const mockQueue = {
      getStatus: mock(() => ({ pending: 2, failed: 1, synced: 10, permanently_failed: 0 })),
      getFailedItems: mock(() => [{ id: 1, type: 'observation', retries: 2, lastError: 'timeout' }]),
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
      getStatus: mock(() => { throw new Error('db error'); }),
      getFailedItems: mock(() => []),
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
      getStatus: mock(() => ({ pending: 0, failed: 0, synced: 0, permanently_failed: 0 })),
      getFailedItems: mock(() => []),
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
      getStatus: mock(() => ({ pending: 0, failed: 0, synced: 0, permanently_failed: 0 })),
      getFailedItems: mock(() => []),
    };
    const mockHealth = {
      check: mock(async () => ({ uptimeSeconds: 10, chroma: 'ok', syncServer: 'ok', workerVersion: '1.0.0' })),
    };
    const errorStore = new ErrorStore(5);
    errorStore.push({ level: 'error', ctx: 'TEST', msg: 'something broke', ts: new Date().toISOString() });

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
    expect(result.errors[0].msg).toBe('something broke');
  });

  it('returns null extraction when worker has extraction disabled', async () => {
    const mockQueue = {
      getStatus: mock(() => ({ pending: 0, failed: 0, synced: 0, permanently_failed: 0 })),
      getFailedItems: mock(() => []),
    };
    const mockWorker = { getExtractionStats: mock(() => null) }; // non-null worker, but returns null
    const mockHealth = {
      check: mock(async () => ({ uptimeSeconds: 0, chroma: 'unavailable', syncServer: 'unavailable', workerVersion: '1.0.0' })),
    };
    const errorStore = new ErrorStore(5);
    const routes = new AdminRoutes({ queue: mockQueue, syncWorker: mockWorker, healthChecker: mockHealth as any, errorStore });

    const mockRes = { json: mock((data: any) => data) };
    await (routes as any).handle({}, mockRes);
    const result = mockRes.json.mock.calls[0][0];
    expect(result.extraction).toBeNull();
  });

  it('registers GET /api/admin via setupRoutes', () => {
    const errorStore = new ErrorStore(5);
    const mockQueue = {
      getStatus: mock(() => ({ pending: 0, failed: 0, synced: 0, permanently_failed: 0 })),
      getFailedItems: mock(() => []),
    };
    const mockHealth = { check: mock(async () => ({ uptimeSeconds: 0, chroma: 'ok', syncServer: 'ok', workerVersion: '1.0.0' })) };

    const routes = new AdminRoutes({
      queue: mockQueue,
      syncWorker: null,
      healthChecker: mockHealth as any,
      errorStore,
    });

    // Verify setupRoutes registers the /api/admin GET handler on the express app
    const registeredRoutes: Array<{ method: string; path: string }> = [];
    const mockApp = {
      get: (path: string, _handler: unknown) => { registeredRoutes.push({ method: 'get', path }); },
    } as any;

    routes.setupRoutes(mockApp);

    expect(registeredRoutes).toHaveLength(1);
    expect(registeredRoutes[0].method).toBe('get');
    expect(registeredRoutes[0].path).toBe('/api/admin');
  });
});
