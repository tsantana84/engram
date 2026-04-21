import { describe, it, expect, mock } from 'bun:test';
import { HealthChecker } from './HealthChecker';

describe('HealthChecker', () => {
  it('returns ok when chroma healthy', async () => {
    const chromaManager = { isHealthy: mock(async () => true) };
    const checker = new HealthChecker({ chromaManager, syncServerUrl: null });
    const result = await checker.check();
    expect(result.chroma).toBe('ok');
  });

  it('returns error when chroma throws', async () => {
    const chromaManager = { isHealthy: mock(async () => { throw new Error('fail'); }) };
    const checker = new HealthChecker({ chromaManager, syncServerUrl: null });
    const result = await checker.check();
    expect(result.chroma).toBe('error');
  });

  it('returns error when chroma returns false', async () => {
    const chromaManager = { isHealthy: mock(async () => false) };
    const checker = new HealthChecker({ chromaManager, syncServerUrl: null });
    const result = await checker.check();
    expect(result.chroma).toBe('error');
  });

  it('returns unavailable when no chroma manager', async () => {
    const checker = new HealthChecker({ chromaManager: null, syncServerUrl: null });
    const result = await checker.check();
    expect(result.chroma).toBe('unavailable');
  });

  it('returns unavailable when no sync server url', async () => {
    const checker = new HealthChecker({ chromaManager: null, syncServerUrl: null });
    const result = await checker.check();
    expect(result.syncServer).toBe('unavailable');
  });

  it('includes uptimeSeconds and workerVersion', async () => {
    const checker = new HealthChecker({ chromaManager: null, syncServerUrl: null });
    const result = await checker.check();
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(result.workerVersion).toBeTypeOf('string');
  });

  it('returns ok when sync server is healthy', async () => {
    // Mock fetch for sync server
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
    })) as any;

    try {
      const checker = new HealthChecker({ chromaManager: null, syncServerUrl: 'http://localhost:3000' });
      const result = await checker.check();
      expect(result.syncServer).toBe('ok');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns error when sync server returns non-ok status', async () => {
    // Mock fetch for sync server
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 500,
    })) as any;

    try {
      const checker = new HealthChecker({ chromaManager: null, syncServerUrl: 'http://localhost:3000' });
      const result = await checker.check();
      expect(result.syncServer).toBe('error');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns error when sync server fetch throws', async () => {
    // Mock fetch for sync server
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => { throw new Error('Network error'); }) as any;

    try {
      const checker = new HealthChecker({ chromaManager: null, syncServerUrl: 'http://localhost:3000' });
      const result = await checker.check();
      expect(result.syncServer).toBe('error');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
