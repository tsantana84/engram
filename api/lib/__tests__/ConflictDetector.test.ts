import { describe, expect, test } from 'bun:test';
import { ServerConflictDetector } from '../ConflictDetector.js';

function fakeSimilar(rows: Array<{ id: number; title: string }>) {
  return async () =>
    rows.map((r) => ({ id: r.id, title: r.title, narrative: null, agent_name: 'a', git_branch: null }));
}

describe('ServerConflictDetector', () => {
  test('disabled config -> ADD', async () => {
    const det = new ServerConflictDetector({ enabled: false, llm: async () => '{}', fetchSimilar: fakeSimilar([]) });
    const out = await det.check({ title: 'x', narrative: null });
    expect(out.decision).toBe('ADD');
  });

  test('no similar -> ADD', async () => {
    const det = new ServerConflictDetector({
      enabled: true,
      llm: async () => '{"decision":"UPDATE","targetId":1}',
      fetchSimilar: fakeSimilar([]),
    });
    const out = await det.check({ title: 'x', narrative: null });
    expect(out.decision).toBe('ADD');
  });

  test('LLM UPDATE with targetId preserved', async () => {
    const det = new ServerConflictDetector({
      enabled: true,
      llm: async () => '{"decision":"UPDATE","targetId":42,"reason":"supersedes"}',
      fetchSimilar: fakeSimilar([{ id: 42, title: 'old' }]),
    });
    const out = await det.check({ title: 'new', narrative: null });
    expect(out.decision).toBe('UPDATE');
    expect(out.targetId).toBe(42);
  });

  test('malformed JSON falls back to ADD', async () => {
    const det = new ServerConflictDetector({
      enabled: true,
      llm: async () => 'banana',
      fetchSimilar: fakeSimilar([{ id: 1, title: 'x' }]),
    });
    const out = await det.check({ title: 'x', narrative: null });
    expect(out.decision).toBe('ADD');
  });
});
