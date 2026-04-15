import { describe, it, expect } from 'bun:test';
import { ConflictDetector } from '../../../src/services/sync/ConflictDetector.js';

describe('ConflictDetector', () => {
  it('returns ADD when no similar observations exist', async () => {
    const detector = new ConflictDetector({
      fetchSimilar: async () => [],
      llm: async () => JSON.stringify({ decision: 'ADD' }),
    });
    const result = await detector.check({ title: 'New thing', narrative: 'details' });
    expect(result.decision).toBe('ADD');
  });

  it('skips LLM call when no similar observations', async () => {
    let llmCalled = false;
    const detector = new ConflictDetector({
      fetchSimilar: async () => [],
      llm: async () => { llmCalled = true; return '{}'; },
    });
    await detector.check({ title: 'New thing' });
    expect(llmCalled).toBe(false);
  });

  it('returns INVALIDATE with targetId for direct contradiction', async () => {
    const detector = new ConflictDetector({
      fetchSimilar: async () => [{ id: 42, title: 'We use pattern X', narrative: 'X is standard', agent_name: 'thiago' }],
      llm: async () => JSON.stringify({ decision: 'INVALIDATE', targetId: 42, reason: 'New info supersedes old' }),
    });
    const result = await detector.check({ title: 'Switched to pattern Y', narrative: 'X is deprecated' });
    expect(result.decision).toBe('INVALIDATE');
    expect(result.targetId).toBe(42);
    expect(result.reason).toBe('New info supersedes old');
  });

  it('returns ADD when similar but not conflicting', async () => {
    const detector = new ConflictDetector({
      fetchSimilar: async () => [{ id: 1, title: 'Related thing', narrative: 'tangential' }],
      llm: async () => JSON.stringify({ decision: 'ADD' }),
    });
    const result = await detector.check({ title: 'New aspect', narrative: 'different angle' });
    expect(result.decision).toBe('ADD');
  });

  it('defaults to ADD if LLM call throws', async () => {
    const detector = new ConflictDetector({
      fetchSimilar: async () => [{ id: 1, title: 'Something', narrative: 'info' }],
      llm: async () => { throw new Error('LLM unavailable'); },
    });
    const result = await detector.check({ title: 'New thing', narrative: 'details' });
    expect(result.decision).toBe('ADD');
  });

  it('defaults to ADD when enabled is false', async () => {
    let llmCalled = false;
    const detector = new ConflictDetector({
      fetchSimilar: async () => [{ id: 1, title: 'X' }],
      llm: async () => { llmCalled = true; return JSON.stringify({ decision: 'NOOP' }); },
      enabled: false,
    });
    const result = await detector.check({ title: 'Y' });
    expect(result.decision).toBe('ADD');
    expect(llmCalled).toBe(false);
  });

  it('defaults to ADD when llm is not provided', async () => {
    const detector = new ConflictDetector({
      fetchSimilar: async () => [{ id: 1, title: 'X' }],
    });
    const result = await detector.check({ title: 'Y' });
    expect(result.decision).toBe('ADD');
  });

  it('handles malformed LLM JSON gracefully', async () => {
    const detector = new ConflictDetector({
      fetchSimilar: async () => [{ id: 1, title: 'Something' }],
      llm: async () => 'not valid json at all',
    });
    const result = await detector.check({ title: 'New thing' });
    expect(result.decision).toBe('ADD');
  });
});
