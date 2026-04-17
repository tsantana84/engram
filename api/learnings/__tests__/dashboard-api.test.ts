import { describe, expect, test, mock, beforeEach } from 'bun:test';
// Import the real SupabaseManager class so we can re-export it from our mock.
// This prevents Bun's shared module registry from breaking api/lib/__tests__/SupabaseManager-learnings.test.ts
// which instantiates new SupabaseManager(...) — it needs the real class, not our stub.
import { SupabaseManager as RealSupabaseManager } from '../../../api/lib/SupabaseManager.js';

// --- Mock state ---
let mockAuthResult: { agentId: string; agentName: string } | null = null;
let mockListResult: any[] = [];
let mockGetResult: any | null = null;
let mockReviewResult: any = { id: 1, status: 'approved' };
// Control LLM decision for approve/NOOP paths (real ConflictDetector is used)
let mockLlmDecision = '{"decision":"ADD"}';
// fetchSimilarLearnings — return candidates to make detector invoke LLM
let mockFetchSimilarResult: any[] = [];
let fetchSimilarLastQuery: string | null = null;
let listLearningsLastOpts: any = null;
let reviewLearningLastPatch: any = null;

// Hoist module mocks before any imports of the handlers
mock.module('../../../api/auth.js', () => ({
  authenticateRequest: async (req: any) => {
    const auth = req.headers?.authorization;
    return auth === 'Bearer valid'
      ? mockAuthResult ?? { agentId: 'agent-123', agentName: 'test-agent' }
      : null;
  },
  withAuth: undefined,
}));

mock.module('../../../api/lib/SupabaseManager.js', () => ({
  initSupabase: async () => ({
    listLearnings: async (opts: any) => {
      listLearningsLastOpts = opts;
      return mockListResult;
    },
    getLearning: async (_id: number) => mockGetResult,
    reviewLearning: async (_id: number, patch: any) => {
      reviewLearningLastPatch = patch;
      return { ...mockReviewResult, ...patch };
    },
    invalidateLearning: async () => {},
    fetchSimilarLearnings: async (query: string) => {
      fetchSimilarLastQuery = query;
      return mockFetchSimilarResult;
    },
  }),
  // Re-export the real SupabaseManager class so that downstream test files
  // (api/lib/__tests__/SupabaseManager-learnings.test.ts) that do `new SupabaseManager(...)`
  // still get a fully-functional class when this mock persists in Bun's shared module registry.
  SupabaseManager: RealSupabaseManager,
  getSupabaseInstance: () => ({}),
  resetSupabase: () => {},
}));

// Mock LLM — return mockLlmDecision (controlled per test)
mock.module('../../../api/lib/llm.js', () => ({
  getLlmClosure: () => async () => mockLlmDecision,
}));

// NOTE: ConflictDetector is NOT mocked — we use the real implementation.
// Decision is controlled via mockLlmDecision + mockFetchSimilarResult.

// Helper to build a fake res object
function mockRes() {
  const r: any = { statusCode: 200, body: null, headers: {} };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  r.end = () => r;
  return r;
}

async function callList(req: any) {
  const res = mockRes();
  const { default: handler } = await import('../list.js');
  await handler(req, res);
  return res;
}

async function callDetail(req: any) {
  const res = mockRes();
  const { default: handler } = await import('../detail.js');
  await handler(req, res);
  return res;
}

async function callReview(req: any) {
  const res = mockRes();
  const { default: handler } = await import('../review.js');
  await handler(req, res);
  return res;
}

describe('Dashboard API', () => {
  beforeEach(() => {
    // Reset all shared state before each test
    mockAuthResult = null;
    mockListResult = [];
    mockGetResult = {
      id: 1, claim: 'test', evidence: 'ev', scope: null, status: 'pending',
      project: 'p', source_session: 's', content_hash: 'h', confidence: 0.9,
      invalidated: false, invalidated_by: null, extracted_at: '2026-01-01',
      reviewed_at: null, reviewed_by: null, edit_diff: null, rejection_reason: null,
    };
    mockReviewResult = { id: 1, status: 'approved' };
    mockLlmDecision = '{"decision":"ADD"}';
    mockFetchSimilarResult = [];
    fetchSimilarLastQuery = null;
    listLearningsLastOpts = null;
    reviewLearningLastPatch = null;
    process.env.SUPABASE_URL = 'http://test.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'test-anon-key';
    process.env.ANTHROPIC_API_KEY = 'test-api-key';
  });

  // --- List tests ---
  describe('GET /api/learnings', () => {
    test('1. returns 401 when unauthenticated', async () => {
      const res = await callList({
        method: 'GET',
        headers: { authorization: 'Bearer bad-key' },
        query: {},
      });
      expect(res.statusCode).toBe(401);
      expect(res.body?.error).toBe('Unauthorized');
    });

    test('2. filters by status query param — calls listLearnings with status=pending', async () => {
      mockListResult = [{ id: 10, claim: 'c', status: 'pending' }];
      const res = await callList({
        method: 'GET',
        headers: { authorization: 'Bearer valid' },
        query: { status: 'pending' },
      });
      expect(res.statusCode).toBe(200);
      expect(listLearningsLastOpts?.status).toBe('pending');
      expect(res.body?.learnings).toHaveLength(1);
    });
  });

  // --- Detail tests ---
  describe('GET /api/learnings/:id', () => {
    test('3. returns 404 for unknown id (getLearning returns null)', async () => {
      mockGetResult = null;
      const res = await callDetail({
        method: 'GET',
        headers: { authorization: 'Bearer valid' },
        query: { id: '999' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.body?.error).toBe('Not found');
    });
  });

  // --- Review tests ---
  describe('POST /api/learnings/:id/review', () => {
    test('4. approve — calls detector (fetchSimilar invoked), returns status=approved', async () => {
      // No similar candidates → real detector returns ADD → approved path
      mockFetchSimilarResult = [];
      const res = await callReview({
        method: 'POST',
        headers: { authorization: 'Bearer valid' },
        query: { id: '1' },
        body: { action: 'approve' },
      });
      expect(res.statusCode).toBe(200);
      // fetchSimilarLastQuery being set proves the detector ran fetchSimilar
      expect(fetchSimilarLastQuery).toBe('test');
      expect(res.body?.learning?.status).toBe('approved');
    });

    test('5. reject — sets status=rejected and persists rejection_reason', async () => {
      const res = await callReview({
        method: 'POST',
        headers: { authorization: 'Bearer valid' },
        query: { id: '1' },
        body: { action: 'reject', rejection_reason: 'Not accurate' },
      });
      expect(res.statusCode).toBe(200);
      // Reject bypasses detector — fetchSimilar never called
      expect(fetchSimilarLastQuery).toBeNull();
      expect(reviewLearningLastPatch?.status).toBe('rejected');
      expect(reviewLearningLastPatch?.rejection_reason).toBe('Not accurate');
    });

    test('6. edit_approve — records edit_diff and uses edited values as detector input', async () => {
      mockGetResult = {
        id: 5,
        claim: 'orig',
        evidence: 'orig-ev',
        scope: null,
        status: 'pending',
        project: 'p',
        source_session: 's',
        content_hash: 'h',
        confidence: 0.9,
        invalidated: false,
        invalidated_by: null,
        extracted_at: '2026-01-01',
        reviewed_at: null,
        reviewed_by: null,
        edit_diff: null,
        rejection_reason: null,
      };
      // No candidates → ADD decision
      mockFetchSimilarResult = [];
      const res = await callReview({
        method: 'POST',
        headers: { authorization: 'Bearer valid' },
        query: { id: '5' },
        body: { action: 'edit_approve', edited: { claim: 'edited-claim' } },
      });
      expect(res.statusCode).toBe(200);
      // Detector received the edited claim as the search query (via fetchSimilar)
      expect(fetchSimilarLastQuery).toBe('edited-claim');
      // edit_diff was recorded with before/after
      expect(reviewLearningLastPatch?.edit_diff?.before).toBeDefined();
      expect((reviewLearningLastPatch?.edit_diff?.after as any)?.claim).toBe('edited-claim');
    });

    test('7. detector NOOP — returns rejected with reason dedupe_noop', async () => {
      // Provide a candidate so LLM is invoked, and set LLM to return NOOP
      mockFetchSimilarResult = [{ id: 99, title: 'similar claim', narrative: null }];
      mockLlmDecision = '{"decision":"NOOP"}';
      const res = await callReview({
        method: 'POST',
        headers: { authorization: 'Bearer valid' },
        query: { id: '1' },
        body: { action: 'approve' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.body?.learning?.status).toBe('rejected');
      expect(reviewLearningLastPatch?.rejection_reason).toBe('dedupe_noop: detector judged duplicate');
    });

    test('8. approve returns 500 when ANTHROPIC_API_KEY missing', async () => {
      const savedKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try {
        const res = await callReview({
          method: 'POST',
          headers: { authorization: 'Bearer valid' },
          query: { id: '1' },
          body: { action: 'approve' },
        });
        expect(res.statusCode).toBe(500);
        expect(res.body?.error).toContain('ANTHROPIC_API_KEY');
      } finally {
        if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
      }
    });

    test('9. edit_approve rejects disallowed fields in edited', async () => {
      mockGetResult = {
        id: 5, claim: 'orig', evidence: 'orig-ev', scope: null, status: 'pending',
        project: 'p', source_session: 's', content_hash: 'h', confidence: 0.9,
        invalidated: false, invalidated_by: null, extracted_at: '2026-01-01',
        reviewed_at: null, reviewed_by: null, edit_diff: null, rejection_reason: null,
      };
      const res = await callReview({
        method: 'POST',
        headers: { authorization: 'Bearer valid' },
        query: { id: '5' },
        body: {
          action: 'edit_approve',
          edited: { claim: 'ok', status: 'sneaky' }, // 'status' not in allowlist
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.body?.error).toContain('disallowed');
      expect(res.body?.invalid).toEqual(['status']);
    });
  });
});
