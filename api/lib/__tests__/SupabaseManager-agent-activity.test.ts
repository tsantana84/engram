import { describe, expect, test } from 'bun:test';
import { SupabaseManager } from '../SupabaseManager.js';

function makeClient(
  agents: Array<{ id: string; name: string }>,
  obsCountByAgent: Record<string, number>,
  lastSeenByAgent: Record<string, string | null>,
  sessionCountByAgent: Record<string, number>,
  learningCountByAgent: Record<string, number>,
) {
  return {
    from: (table: string) => {
      if (table === 'agents') {
        return {
          select: (_cols: string) => ({
            data: agents,
            error: null,
          }),
        };
      }
      if (table === 'observations') {
        return {
          select: (_cols: string, opts?: any) => {
            if (opts?.head) {
              return {
                eq: (_col: string, val: string) => ({
                  count: obsCountByAgent[val] ?? 0,
                  error: null,
                }),
              };
            }
            return {
              eq: (_col: string, val: string) => ({
                order: () => ({
                  limit: () => {
                    const ts = lastSeenByAgent[val];
                    return { data: ts ? [{ created_at: ts }] : [], error: null };
                  },
                }),
              }),
            };
          },
        };
      }
      if (table === 'sessions') {
        return {
          select: (_cols: string, _opts?: any) => ({
            eq: (_col: string, val: string) => ({
              count: sessionCountByAgent[val] ?? 0,
              error: null,
            }),
          }),
        };
      }
      if (table === 'learnings') {
        return {
          select: (_cols: string, _opts?: any) => ({
            eq: (_col: string, val: string) => ({
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
    const mgr = new SupabaseManager(makeClient(
      agents,
      { 'agent-1': 3, 'agent-2': 0 },
      { 'agent-1': '2026-04-20T12:00:00Z', 'agent-2': null },
      { 'agent-1': 2, 'agent-2': 0 },
      { 'agent-1': 3, 'agent-2': 0 },
    ) as any);
    const result = await mgr.getAgentActivity();

    expect(result).toHaveLength(2);

    const alpha = result.find(r => r.id === 'agent-1')!;
    expect(alpha.name).toBe('Alpha');
    expect(alpha.observationCount).toBe(3);
    expect(alpha.sessionCount).toBe(2);
    expect(alpha.learningCount).toBe(3);
    expect(alpha.lastSeenAt).toBe('2026-04-20T12:00:00Z');
  });

  test('handles empty agents list', async () => {
    const mgr = new SupabaseManager(makeClient([], {}, {}, {}, {}) as any);
    const result = await mgr.getAgentActivity();
    expect(result).toHaveLength(0);
  });

  test('counts distinct sessions correctly', async () => {
    const agents = [{ id: 'agent-x', name: 'X' }];
    const mgr = new SupabaseManager(makeClient(
      agents,
      { 'agent-x': 5 },
      { 'agent-x': '2026-04-05T00:00:00Z' },
      { 'agent-x': 3 },
      {},
    ) as any);
    const result = await mgr.getAgentActivity();

    expect(result[0].sessionCount).toBe(3);
    expect(result[0].observationCount).toBe(5);
    expect(result[0].lastSeenAt).toBe('2026-04-05T00:00:00Z');
    expect(result[0].learningCount).toBe(0);
  });

  test('returns null lastSeenAt when agent has no observations', async () => {
    const agents = [{ id: 'agent-empty', name: 'Empty' }];
    const mgr = new SupabaseManager(makeClient(agents, {}, {}, {}, {}) as any);
    const result = await mgr.getAgentActivity();

    expect(result[0].lastSeenAt).toBeNull();
    expect(result[0].sessionCount).toBe(0);
    expect(result[0].observationCount).toBe(0);
  });
});
