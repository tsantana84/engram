import { describe, expect, test, beforeEach } from 'bun:test';
import { SessionStore } from '../../sqlite/SessionStore.js';
import { SyncQueue } from '../SyncQueue.js';
import { SyncWorker } from '../SyncWorker.js';
import type { LearningPayload, LearningTargetStatus } from '../learning-types.js';

function makeWorker(store: SessionStore, queue: SyncQueue, agentName = 'test-agent') {
  const worker = new SyncWorker({
    enabled: true,
    queue,
    sessionStore: store,
    serverUrl: 'http://localhost:0',
    apiKey: 'cmem_ak_test',
    agentName,
    intervalMs: 60_000,
    timeoutMs: 1_000,
    maxRetries: 5,
    batchSize: 100,
  });
  (worker as any).client = {
    pushLearnings: async () => ({ results: [] }),
    push: async () => ({ accepted: 0, duplicates: 0, errors: [] }),
    fetchSimilar: async () => [],
    pushInvalidations: async () => {},
  };
  return worker;
}

describe('SyncWorker tick logging', () => {
  let store: SessionStore;
  let queue: SyncQueue;

  beforeEach(() => {
    store = new SessionStore(':memory:');
    queue = new SyncQueue(store.db);
  });

  test('IDLE tick is recorded when queue is empty', async () => {
    const worker = makeWorker(store, queue);
    await worker.tick();
    const ticks = store.getTickLog(10);
    expect(ticks).toHaveLength(1);
    expect(ticks[0].items_pushed).toBe(0);
    expect(ticks[0].items_failed).toBe(0);
    expect(ticks[0].sessions_extracted).toBe(0);
  });

  test('agent_name is recorded correctly', async () => {
    const worker = makeWorker(store, queue, 'thiago');
    await worker.tick();
    const ticks = store.getTickLog(10);
    expect(ticks[0].agent_name).toBe('thiago');
  });

  test('duration_ms is non-negative', async () => {
    const worker = makeWorker(store, queue);
    await worker.tick();
    const ticks = store.getTickLog(10);
    expect(ticks[0].duration_ms).toBeGreaterThanOrEqual(0);
  });

  test('items_pushed increments on successful learning push', async () => {
    const worker = makeWorker(store, queue);
    const payload = { claim: 'A', evidence: 'e', scope: 'local', confidence: 0.9 } as any;
    queue.enqueueLearning(payload, 'approved');
    queue.enqueueLearning(payload, 'approved');
    queue.enqueueLearning(payload, 'pending');
    await worker.tick();
    const ticks = store.getTickLog(10);
    expect(ticks[0].items_pushed).toBe(3);
    expect(ticks[0].items_failed).toBe(0);
  });

  test('items_failed and errors recorded when push throws', async () => {
    const worker = makeWorker(store, queue);
    (worker as any).client = {
      pushLearnings: async () => { throw new Error('Network error'); },
      push: async () => ({ accepted: 0, duplicates: 0, errors: [] }),
      fetchSimilar: async () => [],
      pushInvalidations: async () => {},
    };
    queue.enqueueLearning({ claim: 'A', evidence: 'e', scope: 'local', confidence: 0.9 } as any, 'approved');
    await worker.tick();
    const ticks = store.getTickLog(10);
    expect(ticks[0].items_failed).toBeGreaterThan(0);
    expect(ticks[0].errors.length).toBeGreaterThan(0);
  });

  test('every tick call records a row', async () => {
    const worker = makeWorker(store, queue);
    await worker.tick();
    await worker.tick();
    await worker.tick();
    expect(store.getTickLog(10)).toHaveLength(3);
  });
});
