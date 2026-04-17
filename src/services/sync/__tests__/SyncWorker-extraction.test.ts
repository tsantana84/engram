import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { SessionStore } from '../../sqlite/SessionStore.js';
import { SyncQueue } from '../SyncQueue.js';
import { SyncWorker } from '../SyncWorker.js';
import type { LearningExtractor, SessionInput } from '../LearningExtractor.js';
import type { ExtractedLearning, LearningPayload, LearningTargetStatus } from '../learning-types.js';

interface PushLearningsCall {
  learnings: LearningPayload[];
  target_status: LearningTargetStatus;
}

interface FakeClient {
  pushLearnings: (learnings: LearningPayload[], target_status: LearningTargetStatus) => Promise<any>;
  push: (payload: any) => Promise<any>;
  learningsCalls: PushLearningsCall[];
  pushCalls: any[];
}

interface FakeExtractor {
  extract: (input: SessionInput) => Promise<ExtractedLearning[]>;
  inputs: SessionInput[];
}

function makeFakeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  const learningsCalls: PushLearningsCall[] = [];
  const pushCalls: any[] = [];
  return {
    learningsCalls,
    pushCalls,
    pushLearnings: overrides.pushLearnings ?? (async (learnings, target_status) => {
      learningsCalls.push({ learnings, target_status });
      return { results: [] };
    }),
    push: overrides.push ?? (async (payload) => {
      pushCalls.push(payload);
      return { accepted: 0, duplicates: 0, errors: [] };
    }),
  };
}

function makeFakeExtractor(
  impl: (input: SessionInput) => Promise<ExtractedLearning[]>,
): FakeExtractor & LearningExtractor {
  const inputs: SessionInput[] = [];
  const fake = {
    inputs,
    async extract(input: SessionInput) {
      inputs.push(input);
      return impl(input);
    },
  };
  return fake as FakeExtractor & LearningExtractor;
}

function makeWorker(opts: {
  store: SessionStore;
  queue: SyncQueue;
  client: FakeClient;
  extractor?: LearningExtractor;
  confidenceThreshold?: number;
  extractionEnabled?: boolean;
  extractionMaxRetries?: number;
}): SyncWorker {
  const worker = new SyncWorker({
    enabled: true,
    queue: opts.queue,
    sessionStore: opts.store,
    serverUrl: 'http://localhost:0',
    apiKey: 'cmem_ak_test',
    agentName: 'Test',
    intervalMs: 60_000,
    timeoutMs: 1_000,
    maxRetries: 5,
    batchSize: 100,
    extractor: opts.extractor,
    confidenceThreshold: opts.confidenceThreshold,
    extractionEnabled: opts.extractionEnabled,
    extractionMaxRetries: opts.extractionMaxRetries,
  });
  // Swap in fake client so we never hit the network.
  (worker as unknown as { client: FakeClient }).client = opts.client;
  return worker;
}

function seedSession(
  store: SessionStore,
  opts: { content: string; memory: string; project: string } = {
    content: 'content-sess-1',
    memory: 'memory-sess-1',
    project: 'engram',
  },
): { id: number; memory: string } {
  const id = store.createSDKSession(opts.content, opts.project, 'fix readiness');
  store.updateMemorySessionId(id, opts.memory);
  store.markSessionCompleted(id);
  store.storeObservation(opts.memory, opts.project, {
    type: 'discovery',
    title: 'Readiness depends on init',
    subtitle: null,
    facts: ['503 until init done'],
    narrative: 'Worker blocks readiness until initialize() resolves.',
    concepts: ['readiness', 'init'],
    files_read: ['worker-service.ts'],
    files_modified: [],
  });
  store.storeSummary(opts.memory, opts.project, {
    request: 'Fix readiness check',
    investigated: 'boot order',
    learned: 'init must complete before 200',
    completed: 'fix deployed',
    next_steps: 'add regression test',
    notes: null,
  });
  return { id, memory: opts.memory };
}

describe('SyncWorker — learning extraction flow', () => {
  let db: Database;
  let store: SessionStore;
  let queue: SyncQueue;

  beforeEach(() => {
    db = new Database(':memory:');
    // SessionStore wraps its own DB; for tests we build one pointing at :memory:.
    store = new SessionStore(':memory:');
    queue = new SyncQueue(store.db);
    store.setSyncQueue(queue);
  });

  afterEach(() => {
    store.close();
    db.close();
  });

  test('high-confidence learning queued with target_status=approved', async () => {
    const { id } = seedSession(store);
    const extractor = makeFakeExtractor(async () => [
      { claim: 'c-high', evidence: 'e', scope: 'area', confidence: 0.95 },
    ]);
    const client = makeFakeClient();
    const worker = makeWorker({
      store, queue, client, extractor,
      extractionEnabled: true, confidenceThreshold: 0.8,
    });

    await worker.extractSessionLearnings(id);

    const learnings = queue.getPending(100).filter((p) => p.entity_type === 'learning');
    expect(learnings.length).toBe(1);
    expect(learnings[0].target_status).toBe('approved');
    expect(learnings[0].payload?.claim).toBe('c-high');
    expect(learnings[0].payload?.project).toBe('engram');

    // Session marked as done
    const row = store.db.query<{ extraction_status: string }, [number]>(
      'SELECT extraction_status FROM sdk_sessions WHERE id = ?',
    ).get(id);
    expect(row?.extraction_status).toBe('done');
  });

  test('low-confidence learning queued with target_status=pending', async () => {
    const { id } = seedSession(store);
    const extractor = makeFakeExtractor(async () => [
      { claim: 'c-low', evidence: null, scope: null, confidence: 0.5 },
    ]);
    const client = makeFakeClient();
    const worker = makeWorker({
      store, queue, client, extractor,
      extractionEnabled: true, confidenceThreshold: 0.8,
    });

    await worker.extractSessionLearnings(id);

    const learnings = queue.getPending(100).filter((p) => p.entity_type === 'learning');
    expect(learnings.length).toBe(1);
    expect(learnings[0].target_status).toBe('pending');
    expect(learnings[0].payload?.claim).toBe('c-low');
  });

  test('extractor throws → extraction_status becomes failed, attempts incremented', async () => {
    const { id } = seedSession(store);
    const extractor = makeFakeExtractor(async () => { throw new Error('LLM boom'); });
    const client = makeFakeClient();
    const worker = makeWorker({
      store, queue, client, extractor,
      extractionEnabled: true, extractionMaxRetries: 3,
    });

    await worker.extractSessionLearnings(id);

    const row = store.db.query<{ extraction_status: string; extraction_attempts: number }, [number]>(
      'SELECT extraction_status, extraction_attempts FROM sdk_sessions WHERE id = ?',
    ).get(id);
    expect(row?.extraction_status).toBe('failed');
    expect(row?.extraction_attempts).toBe(1);
  });

  test('max_retries exceeded → status becomes permanently_failed', async () => {
    const { id } = seedSession(store);
    const extractor = makeFakeExtractor(async () => { throw new Error('LLM boom'); });
    const client = makeFakeClient();
    const worker = makeWorker({
      store, queue, client, extractor,
      extractionEnabled: true, extractionMaxRetries: 3,
    });

    // Three consecutive failures should exhaust retries.
    await worker.extractSessionLearnings(id);
    await worker.extractSessionLearnings(id);
    await worker.extractSessionLearnings(id);

    const row = store.db.query<{ extraction_status: string; extraction_attempts: number }, [number]>(
      'SELECT extraction_status, extraction_attempts FROM sdk_sessions WHERE id = ?',
    ).get(id);
    expect(row?.extraction_status).toBe('permanently_failed');
    expect(row?.extraction_attempts).toBe(3);
  });

  test('tick() processes learning queue via SyncClient.pushLearnings', async () => {
    const { id } = seedSession(store);
    const extractor = makeFakeExtractor(async () => [
      { claim: 'c-high', evidence: null, scope: null, confidence: 0.95 },
      { claim: 'c-low',  evidence: null, scope: null, confidence: 0.4  },
    ]);
    const client = makeFakeClient();
    const worker = makeWorker({
      store, queue, client, extractor,
      extractionEnabled: true, confidenceThreshold: 0.8,
    });

    // seedSession leaves the session in the pending pool; tick() should
    // extract first, then drain the queue through pushLearnings.
    await worker.tick();

    // Both groups pushed: one approved call, one pending call.
    const byStatus = Object.fromEntries(client.learningsCalls.map((c) => [c.target_status, c]));
    expect(byStatus.approved?.learnings.length).toBe(1);
    expect(byStatus.pending?.learnings.length).toBe(1);
    expect(byStatus.approved?.learnings[0].claim).toBe('c-high');
    expect(byStatus.pending?.learnings[0].claim).toBe('c-low');

    // Queue should be drained (learnings + legacy rows all handled).
    expect(queue.getPending(10).length).toBe(0);
    // All enqueued rows (legacy observation + summary + 2 learnings) end up synced.
    expect(queue.getStatus().synced).toBe(4);

    // And the session is marked extracted.
    const row = store.db.query<{ extraction_status: string }, [number]>(
      'SELECT extraction_status FROM sdk_sessions WHERE id = ?',
    ).get(id);
    expect(row?.extraction_status).toBe('done');

    // Used id is referenced at least once to keep lint happy.
    expect(id).toBeGreaterThan(0);
  });

  test('startup resets stale in_progress rows to failed', () => {
    // Arrange: create a completed session and force its extraction_status to
    // 'in_progress' — simulating a worker crash mid-LLM call.
    const { id } = seedSession(store);
    store.db.run(
      "UPDATE sdk_sessions SET extraction_status = 'in_progress' WHERE id = ?",
      [id]
    );

    // Act: call start() on a worker with extractionEnabled — triggers the reset.
    const client = makeFakeClient();
    const worker = makeWorker({ store, queue, client, extractionEnabled: true });
    worker.start();
    worker.stop(); // immediately stop the interval; we only care about startup side-effect

    // Assert: row is now 'failed' so the next tick picks it up.
    const row = store.db.query<{ extraction_status: string }, [number]>(
      'SELECT extraction_status FROM sdk_sessions WHERE id = ?'
    ).get(id);
    expect(row?.extraction_status).toBe('failed');
  });

  test('feature flag disabled → legacy observation push still works', async () => {
    const { id, memory } = seedSession(store);

    const client = makeFakeClient();
    // Extractor provided but feature flag off — should not run.
    const extractor = makeFakeExtractor(async () => {
      throw new Error('extractor should not be invoked when flag is off');
    });
    const worker = makeWorker({
      store, queue, client, extractor,
      extractionEnabled: false,
    });

    await worker.tick();

    // Legacy path: observation + summary pushed via client.push(), no learnings.
    expect(client.learningsCalls.length).toBe(0);
    expect(client.pushCalls.length).toBe(1);
    const payload = client.pushCalls[0];
    expect(payload.observations.length).toBeGreaterThan(0);
    expect(payload.summaries.length).toBeGreaterThan(0);

    // Session extraction_status untouched (still 'pending').
    const row = store.db.query<{ extraction_status: string }, [number]>(
      'SELECT extraction_status FROM sdk_sessions WHERE id = ?',
    ).get(id);
    expect(row?.extraction_status).toBe('pending');
    expect(memory).toBe('memory-sess-1');
  });
});
