import { describe, expect, test } from 'bun:test';
import { SupabaseManager } from '../SupabaseManager.js';

function makeClient(agents: Array<{ id: string; name: string }>, observationsByAgent: Record<string, Array<{ created_at: string; session_id: string }>>, learningCountByAgent: Record<string, number>) {
  return {
    from: (table: string) => {
      if (table === 'agents') {
        return {
          select: (_cols: string) => ({
            data: agents,
            error: null,
            // make it awaitable
            then: undefined,
          }),
        };
      }
      if (table === 'observations') {
        return {
          select: (_cols: string) => ({
            eq: (col: string, val: string) => ({
              data: observationsByAgent[val] ?? [],
              error: null,
            }),
          }),
        };
      }
      if (table === 'learnings') {
        return {
          select: (_cols: string, _opts: any) => ({
            eq: (col: string, val: string) => ({
              count: learningCountByAgent[val] ?? 0,
              error: null,
            }),
          }),
        };
      }
      return {};
    },
  };
}

describe('SupabaseManager.getAgentActivity', () => {
  test('returns correct shape per agent', async () => {
    const agents = [
      { id: 'agent-1', name: 'Alpha' },
      { id: 'agent-2', name: 'Beta' },
    ];
    const observations = {
      'agent-1': [
        { created_at: '2026-04-20T10:00:00Z', session_id: 'sess-a' },
        { created_at: '2026-04-20T12:00:00Z', session_id: 'sess-b' },
        { created_at: '2026-04-20T11:00:00Z', session_id: 'sess-a' },
      ],
      'agent-2': [],
    };
    const learningCounts = { 'agent-1': 3, 'agent-2': 0 };

    const mgr = new SupabaseManager(makeClient(agents, observations, learningCounts) as any);
    const result = await mgr.getAgentActivity();

    expect(result).toHaveLength(2);

    const alpha = result.find(r => r.id === 'agent-1')!;
    expect(alpha.name).toBe('Alpha');
    expect(alpha.observationCount).toBe(3);
    expect(alpha.sessionCount).toBe(2); // sess-a and sess-b
    expect(alpha.learningCount).toBe(3);
    expect(alpha.lastSeenAt).toBe('2026-04-20T12:00:00Z');
  });

  test('handles empty agents list', async () => {
    const mgr = new SupabaseManager(makeClient([], {}, {}) as any);
    const result = await mgr.getAgentActivity();
    expect(result).toHaveLength(0);
  });

  test('counts distinct sessions correctly', async () => {
    const agents = [{ id: 'agent-x', name: 'X' }];
    const observations = {
      'agent-x': [
        { created_at: '2026-04-01T00:00:00Z', session_id: 'sess-1' },
        { created_at: '2026-04-02T00:00:00Z', session_id: 'sess-1' },
        { created_at: '2026-04-03T00:00:00Z', session_id: 'sess-2' },
        { created_at: '2026-04-04T00:00:00Z', session_id: 'sess-3' },
        { created_at: '2026-04-05T00:00:00Z', session_id: 'sess-1' },
      ],
    };
    const mgr = new SupabaseManager(makeClient(agents, observations, {}) as any);
    const result = await mgr.getAgentActivity();

    expect(result[0].sessionCount).toBe(3); // sess-1, sess-2, sess-3
    expect(result[0].observationCount).toBe(5);
    expect(result[0].lastSeenAt).toBe('2026-04-05T00:00:00Z');
    expect(result[0].learningCount).toBe(0);
  });

  test('returns null lastSeenAt when agent has no observations', async () => {
    const agents = [{ id: 'agent-empty', name: 'Empty' }];
    const mgr = new SupabaseManager(makeClient(agents, {}, {}) as any);
    const result = await mgr.getAgentActivity();

    expect(result[0].lastSeenAt).toBeNull();
    expect(result[0].sessionCount).toBe(0);
    expect(result[0].observationCount).toBe(0);
  });
});
