import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../../../src/services/sqlite/migrations/runner.js';
import { SyncQueue } from '../../../src/services/sync/SyncQueue.js';
import { SyncWorker } from '../../../src/services/sync/SyncWorker.js';

describe('SyncWorker', () => {
  let db: Database;
  let queue: SyncQueue;

  beforeEach(() => {
    db = new Database(':memory:');
    const runner = new MigrationRunner(db);
    runner.runAllMigrations();
    queue = new SyncQueue(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should not run when sync is disabled', async () => {
    const worker = new SyncWorker({
      enabled: false,
      queue,
      sessionStore: {},
      serverUrl: 'http://localhost:9999',
      apiKey: 'cmem_ak_test',
      agentName: 'Test',
      intervalMs: 1000,
      timeoutMs: 3000,
      maxRetries: 5,
      batchSize: 100,
    });

    await worker.tick();
    expect(queue.getStatus().pending).toBe(0);
  });

  it('should skip tick when queue is empty', async () => {
    const worker = new SyncWorker({
      enabled: true,
      queue,
      sessionStore: {},
      serverUrl: 'http://localhost:9999',
      apiKey: 'cmem_ak_test',
      agentName: 'Test',
      intervalMs: 1000,
      timeoutMs: 3000,
      maxRetries: 5,
      batchSize: 100,
    });

    await worker.tick();
    expect(queue.getStatus().pending).toBe(0);
  });

  it('should be pausable and resumable', () => {
    const worker = new SyncWorker({
      enabled: true,
      queue,
      sessionStore: {},
      serverUrl: 'http://localhost:9999',
      apiKey: 'cmem_ak_test',
      agentName: 'Test',
      intervalMs: 1000,
      timeoutMs: 3000,
      maxRetries: 5,
      batchSize: 100,
    });

    expect(worker.isPaused()).toBe(false);
    worker.pause();
    expect(worker.isPaused()).toBe(true);
    worker.resume();
    expect(worker.isPaused()).toBe(false);
  });

  it('should not drain when paused', async () => {
    const worker = new SyncWorker({
      enabled: true,
      queue,
      sessionStore: {},
      serverUrl: 'http://localhost:9999',
      apiKey: 'cmem_ak_test',
      agentName: 'Test',
      intervalMs: 1000,
      timeoutMs: 3000,
      maxRetries: 5,
      batchSize: 100,
    });

    queue.enqueue('observation', 42);
    worker.pause();
    await worker.tick();

    expect(queue.getStatus().pending).toBe(1);
  });

  describe('getExtractionStats', () => {
    it('returns null when extraction is disabled', () => {
      const worker = new SyncWorker({
        enabled: true,
        queue,
        sessionStore: {},
        serverUrl: 'http://localhost:9999',
        apiKey: 'cmem_ak_test',
        agentName: 'Test',
        intervalMs: 1000,
        timeoutMs: 3000,
        maxRetries: 5,
        batchSize: 100,
        extractionEnabled: false,
      });

      expect(worker.getExtractionStats()).toBeNull();
    });

    it('returns null when extractionEnabled is not set', () => {
      const worker = new SyncWorker({
        enabled: true,
        queue,
        sessionStore: {},
        serverUrl: 'http://localhost:9999',
        apiKey: 'cmem_ak_test',
        agentName: 'Test',
        intervalMs: 1000,
        timeoutMs: 3000,
        maxRetries: 5,
        batchSize: 100,
      });

      expect(worker.getExtractionStats()).toBeNull();
    });

    it('returns stats shape with nulls before any extraction run', () => {
      const worker = new SyncWorker({
        enabled: true,
        queue,
        sessionStore: {},
        serverUrl: 'http://localhost:9999',
        apiKey: 'cmem_ak_test',
        agentName: 'Test',
        intervalMs: 1000,
        timeoutMs: 3000,
        maxRetries: 5,
        batchSize: 100,
        extractionEnabled: true,
        confidenceThreshold: 0.8,
      });

      const stats = worker.getExtractionStats();
      expect(stats).not.toBeNull();
      expect(stats!.enabled).toBe(true);
      expect(stats!.threshold).toBe(0.8);
      expect(stats!.lastRunAt).toBeNull();
      expect(stats!.lastRunStats).toBeNull();
    });

    it('returns populated stats after extraction run', () => {
      const worker = new SyncWorker({
        enabled: true,
        queue,
        sessionStore: {},
        serverUrl: 'http://localhost:9999',
        apiKey: 'cmem_ak_test',
        agentName: 'Test',
        intervalMs: 1000,
        timeoutMs: 3000,
        maxRetries: 5,
        batchSize: 100,
        extractionEnabled: true,
        confidenceThreshold: 0.8,
      });

      const runStats = {
        observationsProcessed: 10,
        extracted: 3,
        skipped: 7,
        failed: 0,
      };
      (worker as any).lastExtractionAt = '2026-04-20T20:00:00Z';
      (worker as any).lastExtractionStats = runStats;

      const result = worker.getExtractionStats();
      expect(result).not.toBeNull();
      expect(result!.lastRunAt).toBe('2026-04-20T20:00:00Z');
      expect(result!.lastRunStats).toEqual(runStats);
    });
  });
});
