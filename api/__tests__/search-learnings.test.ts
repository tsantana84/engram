import { describe, expect, test, mock, beforeEach } from 'bun:test';
// Import the real SupabaseManager class so we can re-export it from our mock.
// This prevents Bun's shared module registry from breaking other test files
// (e.g. SupabaseManager-learnings.test.ts) that instantiate new SupabaseManager(...).
import { SupabaseManager as RealSupabaseManager } from '../../api/lib/SupabaseManager.js';

// --- Mock state ---
let mockAuthResult: { agentId: string; agentName: string } | null = null;
let mockObservationsResult: any[] = [];
let mockLearningsResult: any[] = [];
let searchLearningsLastArgs: { query: string; project: string | undefined; limit: number | undefined } | null = null;
let searchObservationsLastArgs: any = null;

// Hoist module mocks before any imports of the handler
mock.module('../../api/auth.js', () => ({
  authenticateRequest: async (req: any) => {
    const auth = req.headers?.authorization;
    return auth === 'Bearer valid'
      ? mockAuthResult ?? { agentId: 'agent-123', agentName: 'test-agent' }
      : null;
  },
}));

mock.module('../../api/lib/SupabaseManager.js', () => ({
  initSupabase: async () => ({
    searchObservations: async (q: string, opts: any) => {
      searchObservationsLastArgs = { q, ...opts };
      return mockObservationsResult;
    },
    searchLearnings: async (query: string, project?: string, limit?: number) => {
      searchLearningsLastArgs = { query, project, limit };
      return mockLearningsResult;
    },
  }),
  // Re-export the real class so downstream tests that do `new SupabaseManager(...)`
  // still get a functional class when this mock persists in Bun's shared module registry.
  SupabaseManager: RealSupabaseManager,
  getSupabaseInstance: () => ({}),
  resetSupabase: () => {},
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

async function callSearch(req: any) {
  const res = mockRes();
  const { default: handler } = await import('../../api/search.js');
  await handler(req, res);
  return res;
}

describe('GET /api/search — learnings integration', () => {
  beforeEach(() => {
    mockAuthResult = null;
    mockObservationsResult = [];
    mockLearningsResult = [];
    searchLearningsLastArgs = null;
    searchObservationsLastArgs = null;
    process.env.SUPABASE_URL = 'http://test.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  });

  test('1. response includes learnings array alongside results', async () => {
    mockObservationsResult = [{ id: 1, content: 'obs result' }];
    mockLearningsResult = [
      { id: 10, claim: 'foo is fast', status: 'approved', invalidated: false, project: 'p' },
    ];

    const res = await callSearch({
      method: 'GET',
      headers: { authorization: 'Bearer valid' },
      query: { q: 'foo' },
    });

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body?.results)).toBe(true);
    expect(Array.isArray(res.body?.learnings)).toBe(true);
    expect(res.body?.learnings).toHaveLength(1);
    expect(res.body?.learnings[0].claim).toBe('foo is fast');
  });

  test('2. searchLearnings called with correct args (query, project, default limit)', async () => {
    mockLearningsResult = [];
    mockObservationsResult = [];

    const res = await callSearch({
      method: 'GET',
      headers: { authorization: 'Bearer valid' },
      query: { q: 'foo', project: 'my-project' },
    });

    expect(res.statusCode).toBe(200);
    expect(searchLearningsLastArgs?.query).toBe('foo');
    expect(searchLearningsLastArgs?.project).toBe('my-project');
    // limit not passed explicitly — handler uses default
  });

  test('3. only approved + invalidated=false rows surface — mock returns what DB would filter', async () => {
    // The mock simulates SupabaseManager already applying the filter.
    // We verify the handler passes the results through faithfully.
    mockLearningsResult = [
      { id: 20, claim: 'approved learning', status: 'approved', invalidated: false },
    ];
    // A pending or invalidated row would NOT be returned by searchLearnings
    // (filter is inside SupabaseManager). The handler must not re-filter.

    const res = await callSearch({
      method: 'GET',
      headers: { authorization: 'Bearer valid' },
      query: { q: 'foo' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body?.learnings).toHaveLength(1);
    expect(res.body?.learnings[0].status).toBe('approved');
    expect(res.body?.learnings[0].invalidated).toBe(false);
  });

  test('4. searchLearnings NOT called when query is empty string', async () => {
    const res = await callSearch({
      method: 'GET',
      headers: { authorization: 'Bearer valid' },
      query: { q: '' },
    });

    expect(res.statusCode).toBe(200);
    expect(searchLearningsLastArgs).toBeNull();
    // learnings should be empty array
    expect(res.body?.learnings).toEqual([]);
  });

  test('5. searchLearnings NOT called when q param is absent', async () => {
    const res = await callSearch({
      method: 'GET',
      headers: { authorization: 'Bearer valid' },
      query: {},
    });

    expect(res.statusCode).toBe(200);
    expect(searchLearningsLastArgs).toBeNull();
    expect(res.body?.learnings).toEqual([]);
  });

  test('6. if searchLearnings throws, handler returns 500 (throw-through, consistent with observations)', async () => {
    // Rationale: observations errors already propagate as 500. Keeping learnings behavior
    // consistent means agents get a clear signal that search is broken, rather than silently
    // receiving partial results. Graceful degradation would mask DB problems.
    const { initSupabase: origInit } = await import('../../api/lib/SupabaseManager.js');

    // Re-mock to inject a throwing searchLearnings
    mock.module('../../api/lib/SupabaseManager.js', () => ({
      initSupabase: async () => ({
        searchObservations: async () => [{ id: 1 }],
        searchLearnings: async () => { throw new Error('DB connection failed'); },
      }),
      SupabaseManager: RealSupabaseManager,
      getSupabaseInstance: () => ({}),
      resetSupabase: () => {},
    }));

    const res = await callSearch({
      method: 'GET',
      headers: { authorization: 'Bearer valid' },
      query: { q: 'foo' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.body?.error).toBe('Search failed');

    // Restore original mock for subsequent tests
    mock.module('../../api/lib/SupabaseManager.js', () => ({
      initSupabase: async () => ({
        searchObservations: async (q: string, opts: any) => {
          searchObservationsLastArgs = { q, ...opts };
          return mockObservationsResult;
        },
        searchLearnings: async (query: string, project?: string, limit?: number) => {
          searchLearningsLastArgs = { query, project, limit };
          return mockLearningsResult;
        },
      }),
      SupabaseManager: RealSupabaseManager,
      getSupabaseInstance: () => ({}),
      resetSupabase: () => {},
    }));
  });

  test('7. returns 401 when unauthenticated', async () => {
    const res = await callSearch({
      method: 'GET',
      headers: { authorization: 'Bearer bad-token' },
      query: { q: 'foo' },
    });
    expect(res.statusCode).toBe(401);
  });
});
