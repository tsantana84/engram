import { describe, expect, test, mock, beforeEach } from 'bun:test';

// --- Mock state for controlling test scenarios ---
let mockAuthResult: { agentId: string; agentName: string } | null = null;
let mockInsertResult: { id?: number; action: 'inserted' | 'dedupe_noop' } | null = { id: 42, action: 'inserted' };
let mockInsertShouldThrow = false;
let mockFetchSimilarResult: Array<{ id: number; title: string | null; narrative: string | null }> = [];
let mockLlmResult = '{"decision":"ADD"}';
let conflictDetectorCheckCalled = false;

// Hoist module mocks before any imports of the handler
mock.module('../../../api/auth.js', () => ({
  authenticateRequest: async (req: any) => {
    const auth = req.headers?.authorization;
    return auth === 'Bearer valid' ? mockAuthResult ?? { agentId: 'agent-123', agentName: 'test-agent' } : null;
  },
  withAuth: undefined,
}));

mock.module('../../../api/lib/SupabaseManager.js', () => ({
  initSupabase: async () => ({
    fetchSimilarLearnings: async () => mockFetchSimilarResult,
    insertLearning: async () => {
      if (mockInsertShouldThrow) throw new Error('DB connection failed');
      return mockInsertResult;
    },
    invalidateLearning: async () => {},
  }),
  getSupabaseInstance: () => ({}),
  resetSupabase: () => {},
}));

mock.module('../../../api/lib/llm.js', () => ({
  getLlmClosure: () => async () => mockLlmResult,
}));

mock.module('../../../api/lib/ConflictDetector.js', () => ({
  ServerConflictDetector: class MockServerConflictDetector {
    private enabled: boolean;
    constructor(cfg: any) {
      this.enabled = cfg.enabled;
    }
    async check() {
      conflictDetectorCheckCalled = true;
      return { decision: 'ADD' };
    }
  },
}));

// Helper to build a fake res object
function mockRes() {
  const r: any = { statusCode: 200, body: null, headers: {} };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  r.end = () => r;
  return r;
}

// Base valid learning payload
function validLearning() {
  return {
    claim: 'Bun is fast',
    evidence: 'Benchmarks show 3x faster than Node',
    scope: 'backend',
    confidence: 0.9,
    project: 'test-project',
    source_session: 'session-abc',
    content_hash: 'hash-001',
  };
}

async function callHandler(req: any) {
  const res = mockRes();
  // Dynamic import inside call so mocks are guaranteed to apply
  const { default: handler } = await import('../learnings.js');
  await handler(req, res);
  return res;
}

describe('POST /api/sync/learnings', () => {
  beforeEach(() => {
    // Reset shared state before each test
    conflictDetectorCheckCalled = false;
    mockInsertResult = { id: 42, action: 'inserted' };
    mockInsertShouldThrow = false;
    mockFetchSimilarResult = [];
    mockLlmResult = '{"decision":"ADD"}';
    mockAuthResult = null;
    // Satisfy env var guard (initSupabase is fully mocked, values are unused)
    process.env.SUPABASE_URL = 'http://test.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  });

  test('1. returns 405 on non-POST method', async () => {
    const res = await callHandler({
      method: 'GET',
      headers: { authorization: 'Bearer valid' },
      body: {},
    });
    expect(res.statusCode).toBe(405);
    expect(res.body?.error).toBe('Method not allowed');
  });

  test('2. returns 401 when authenticateRequest returns null (missing/invalid bearer)', async () => {
    const res = await callHandler({
      method: 'POST',
      headers: { authorization: 'Bearer invalid-key' },
      body: {
        target_status: 'pending',
        learnings: [validLearning()],
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.body?.error).toBe('Unauthorized');
  });

  test('3. returns 400 on malformed body (missing target_status)', async () => {
    const res = await callHandler({
      method: 'POST',
      headers: { authorization: 'Bearer valid' },
      body: {
        learnings: [validLearning()],
        // target_status missing
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toBe('Invalid payload');
  });

  test('3b. returns 400 on malformed body (non-array learnings)', async () => {
    const res = await callHandler({
      method: 'POST',
      headers: { authorization: 'Bearer valid' },
      body: {
        target_status: 'approved',
        learnings: 'not-an-array',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body?.error).toBe('Invalid payload');
  });

  test('4. target_status="approved" path triggers ServerConflictDetector.check() before insert', async () => {
    mockInsertResult = { id: 99, action: 'inserted' };

    const res = await callHandler({
      method: 'POST',
      headers: { authorization: 'Bearer valid' },
      body: {
        target_status: 'approved',
        learnings: [validLearning()],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(conflictDetectorCheckCalled).toBe(true);
    expect(res.body?.results).toHaveLength(1);
    expect(res.body?.results[0].id).toBe(99);
    expect(res.body?.results[0].action).toBe('inserted');
  });

  test('5. target_status="pending" SKIPS ConflictDetector and inserts with status="pending"', async () => {
    mockInsertResult = { id: 55, action: 'inserted' };

    const res = await callHandler({
      method: 'POST',
      headers: { authorization: 'Bearer valid' },
      body: {
        target_status: 'pending',
        learnings: [validLearning()],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(conflictDetectorCheckCalled).toBe(false);
    expect(res.body?.results).toHaveLength(1);
    expect(res.body?.results[0].id).toBe(55);
    expect(res.body?.results[0].action).toBe('inserted');
  });

  test('6. when insertLearning returns { action: "dedupe_noop" }, result includes action="dedupe_noop" (no id)', async () => {
    mockInsertResult = { action: 'dedupe_noop' }; // no id field

    const res = await callHandler({
      method: 'POST',
      headers: { authorization: 'Bearer valid' },
      body: {
        target_status: 'pending',
        learnings: [validLearning()],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body?.results).toHaveLength(1);
    const result = res.body?.results[0];
    expect(result.action).toBe('dedupe_noop');
    expect(result.id).toBeUndefined();
    expect(result.content_hash).toBe('hash-001');
  });

  test('7. insertLearning throwing → result has action="failed" with error message', async () => {
    mockInsertShouldThrow = true;

    const res = await callHandler({
      method: 'POST',
      headers: { authorization: 'Bearer valid' },
      body: {
        target_status: 'pending',
        learnings: [{ claim: 'c', evidence: null, scope: null, confidence: 0.5, project: 'p', source_session: 's', content_hash: 'h1' }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].action).toBe('failed');
    expect(res.body.results[0].error).toBe('DB connection failed');
    expect(res.body.results[0].content_hash).toBe('h1');
  });
});
