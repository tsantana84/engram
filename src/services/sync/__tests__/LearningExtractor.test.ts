import { describe, expect, test } from 'bun:test';
import { LearningExtractor, type SessionInput } from '../LearningExtractor.js';

function session(overrides: Partial<SessionInput> = {}): SessionInput {
  return {
    sessionId: 'sess-1',
    project: 'engram',
    observations: [
      { title: 'Fixed worker readiness', narrative: 'Readiness returns 503 during init', facts: ['503 status'] },
    ],
    summary: {
      request: 'Fix readiness check',
      investigated: 'worker-service boot order',
      learned: 'Initialization must complete before readiness=200',
      next_steps: 'add regression test',
    },
    ...overrides,
  };
}

describe('LearningExtractor', () => {
  test('parses JSON array output from LLM', async () => {
    const fakeLlm = async () =>
      JSON.stringify([
        { claim: 'readiness gates on init', evidence: 'worker-service.ts', scope: 'area', confidence: 0.92 },
      ]);
    const ex = new LearningExtractor({ enabled: true, llm: fakeLlm });
    const out = await ex.extract(session());
    expect(out.length).toBe(1);
    expect(out[0].claim).toContain('readiness');
    expect(out[0].confidence).toBeCloseTo(0.92);
  });

  test('returns [] when disabled', async () => {
    const ex = new LearningExtractor({ enabled: false, llm: async () => '[]' });
    expect(await ex.extract(session())).toEqual([]);
  });

  test('returns [] on malformed JSON (does not throw)', async () => {
    const ex = new LearningExtractor({ enabled: true, llm: async () => 'totally not json' });
    expect(await ex.extract(session())).toEqual([]);
  });

  test('returns [] when LLM throws', async () => {
    const ex = new LearningExtractor({
      enabled: true,
      llm: async () => { throw new Error('boom'); },
    });
    expect(await ex.extract(session())).toEqual([]);
  });

  test('empty session input returns []', async () => {
    const ex = new LearningExtractor({ enabled: true, llm: async () => '[]' });
    const out = await ex.extract(session({ observations: [], summary: null }));
    expect(out).toEqual([]);
  });

  test('honors maxLearningsPerSession cap', async () => {
    const payload = JSON.stringify(
      Array.from({ length: 20 }, (_, i) => ({
        claim: `c${i}`, evidence: null, scope: null, confidence: 0.9,
      }))
    );
    const ex = new LearningExtractor({
      enabled: true,
      llm: async () => payload,
      maxLearningsPerSession: 5,
    });
    const out = await ex.extract(session());
    expect(out.length).toBe(5);
  });

  test('clamps confidence into [0,1]', async () => {
    const ex = new LearningExtractor({
      enabled: true,
      llm: async () =>
        JSON.stringify([
          { claim: 'a', confidence: 1.5 },
          { claim: 'b', confidence: -0.3 },
        ]),
    });
    const out = await ex.extract(session());
    expect(out[0].confidence).toBe(1);
    expect(out[1].confidence).toBe(0);
  });
});
