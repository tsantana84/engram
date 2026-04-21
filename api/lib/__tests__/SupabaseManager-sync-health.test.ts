import { describe, expect, test } from 'bun:test';
import { SupabaseManager } from '../SupabaseManager.js';

function makeClient(agents: Array<{ id: string; last_synced_at: string | null }>, throwError = false) {
  return {
    from: (table: string) => {
      if (table === 'agents') {
        return {
          select: () => ({
            eq: () => throwError
              ? { data: null, error: new Error('Database connection failed') }
              : { data: agents, error: null },
          }),
        };
      }
      return {};
    },
  };
}

describe('SupabaseManager.getSyncHealth', () => {
  test('returns lastSyncAt per agent from agents table', async () => {
    const mgr = new SupabaseManager(makeClient([
      { id: 'agent-1', last_synced_at: '2026-04-20T12:00:00Z' },
      { id: 'agent-2', last_synced_at: '2026-04-20T15:00:00Z' },
    ]) as any);
    const result = await mgr.getSyncHealth();

    expect(result).toHaveLength(2);
    expect(result.find(r => r.agentId === 'agent-1')!.lastSyncAt).toBe('2026-04-20T12:00:00Z');
    expect(result.find(r => r.agentId === 'agent-2')!.lastSyncAt).toBe('2026-04-20T15:00:00Z');
  });

  test('handles no active agents (returns empty array)', async () => {
    const mgr = new SupabaseManager(makeClient([]) as any);
    const result = await mgr.getSyncHealth();
    expect(result).toHaveLength(0);
  });

  test('returns null lastSyncAt for agents that have never synced', async () => {
    const mgr = new SupabaseManager(makeClient([
      { id: 'agent-x', last_synced_at: null },
    ]) as any);
    const result = await mgr.getSyncHealth();

    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('agent-x');
    expect(result[0].lastSyncAt).toBeNull();
  });

  test('throws on database error', async () => {
    const mgr = new SupabaseManager(makeClient([], true) as any);
    try {
      await mgr.getSyncHealth();
      expect(false).toBe(true);
    } catch (err) {
      expect((err as Error).message).toBe('Database connection failed');
    }
  });
});

describe('SupabaseManager.getLearningQuality', () => {
  test('returns correct counts per status', async () => {
    const client = {
      from: () => ({
        select: () => ({
          data: [
            { status: 'pending', confidence: 0.5 },
            { status: 'pending', confidence: 0.6 },
            { status: 'approved', confidence: 0.95 },
            { status: 'approved', confidence: 0.92 },
            { status: 'rejected', confidence: 0.3 },
          ],
          error: null,
        }),
      }),
    };

    const mgr = new SupabaseManager(client as any);
    const result = await mgr.getLearningQuality();

    expect(result.total).toBe(5);
    expect(result.pending).toBe(2);
    expect(result.approved).toBe(2);
    expect(result.rejected).toBe(1);
  });

  test('approvalRate is null when no reviewed items', async () => {
    const client = {
      from: () => ({
        select: () => ({
          data: [
            { status: 'pending', confidence: 0.5 },
            { status: 'pending', confidence: 0.6 },
          ],
          error: null,
        }),
      }),
    };

    const mgr = new SupabaseManager(client as any);
    const result = await mgr.getLearningQuality();

    expect(result.approvalRate).toBeNull();
  });

  test('approvalRate calculated correctly', async () => {
    const client = {
      from: () => ({
        select: () => ({
          data: [
            { status: 'pending', confidence: 0.5 },
            { status: 'approved', confidence: 0.95 },
            { status: 'approved', confidence: 0.92 },
            { status: 'rejected', confidence: 0.3 },
          ],
          error: null,
        }),
      }),
    };

    const mgr = new SupabaseManager(client as any);
    const result = await mgr.getLearningQuality();

    expect(result.approvalRate).toBe(2 / 3);
  });

  test('confidenceDistribution bins correctly', async () => {
    const client = {
      from: () => ({
        select: () => ({
          data: [
            { status: 'pending', confidence: 0.95 },
            { status: 'pending', confidence: 0.9 },
            { status: 'pending', confidence: 0.85 },
            { status: 'pending', confidence: 0.7 },
            { status: 'pending', confidence: 0.65 },
            { status: 'pending', confidence: 0.5 },
            { status: 'pending', confidence: null },
          ],
          error: null,
        }),
      }),
    };

    const mgr = new SupabaseManager(client as any);
    const result = await mgr.getLearningQuality();

    expect(result.confidenceDistribution.high).toBe(2);
    expect(result.confidenceDistribution.medium).toBe(2);
    expect(result.confidenceDistribution.low).toBe(3);
  });

  test('handles empty learnings', async () => {
    const client = {
      from: () => ({
        select: () => ({
          data: [],
          error: null,
        }),
      }),
    };

    const mgr = new SupabaseManager(client as any);
    const result = await mgr.getLearningQuality();

    expect(result.total).toBe(0);
    expect(result.approvalRate).toBeNull();
    expect(result.confidenceDistribution.high).toBe(0);
  });

  test('throws on database error', async () => {
    const client = {
      from: () => ({
        select: () => ({
          error: new Error('Database connection failed'),
        }),
      }),
    };

    const mgr = new SupabaseManager(client as any);
    try {
      await mgr.getLearningQuality();
      expect(false).toBe(true);
    } catch (err) {
      expect((err as Error).message).toBe('Database connection failed');
    }
  });
});
