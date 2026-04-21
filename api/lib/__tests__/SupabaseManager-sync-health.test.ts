import { describe, expect, test } from 'bun:test';
import { SupabaseManager } from '../SupabaseManager.js';

describe('SupabaseManager.getSyncHealth', () => {
  test('returns max synced_at per agent', async () => {
    const client = {
      from: (table: string) => {
        if (table === 'observations') {
          return {
            select: () => ({
              not: () => ({
                then: undefined,
                data: [
                  { agent_id: 'agent-1', synced_at: '2026-04-20T10:00:00Z' },
                  { agent_id: 'agent-1', synced_at: '2026-04-20T12:00:00Z' },
                  { agent_id: 'agent-1', synced_at: '2026-04-20T11:00:00Z' },
                  { agent_id: 'agent-2', synced_at: '2026-04-20T09:00:00Z' },
                  { agent_id: 'agent-2', synced_at: '2026-04-20T15:00:00Z' },
                ],
                error: null,
              }),
            }),
          };
        }
        return {};
      },
    };

    const mgr = new SupabaseManager(client as any);
    const result = await mgr.getSyncHealth();

    expect(result).toHaveLength(2);
    const agent1 = result.find(r => r.agentId === 'agent-1')!;
    expect(agent1.lastSyncAt).toBe('2026-04-20T12:00:00Z');
    const agent2 = result.find(r => r.agentId === 'agent-2')!;
    expect(agent2.lastSyncAt).toBe('2026-04-20T15:00:00Z');
  });

  test('handles no synced observations (returns empty array)', async () => {
    const client = {
      from: () => ({
        select: () => ({
          not: () => ({
            data: [],
            error: null,
          }),
        }),
      }),
    };

    const mgr = new SupabaseManager(client as any);
    const result = await mgr.getSyncHealth();

    expect(result).toHaveLength(0);
  });

  test('correctly picks max when multiple observations per agent', async () => {
    const client = {
      from: () => ({
        select: () => ({
          not: () => ({
            data: [
              { agent_id: 'agent-x', synced_at: '2026-04-01T00:00:00Z' },
              { agent_id: 'agent-x', synced_at: '2026-04-05T00:00:00Z' },
              { agent_id: 'agent-x', synced_at: '2026-04-03T00:00:00Z' },
              { agent_id: 'agent-x', synced_at: '2026-04-02T00:00:00Z' },
            ],
            error: null,
          }),
        }),
      }),
    };

    const mgr = new SupabaseManager(client as any);
    const result = await mgr.getSyncHealth();

    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('agent-x');
    expect(result[0].lastSyncAt).toBe('2026-04-05T00:00:00Z');
  });

  test('throws on database error', async () => {
    const client = {
      from: () => ({
        select: () => ({
          not: () => ({
            error: new Error('Database connection failed'),
          }),
        }),
      }),
    };

    const mgr = new SupabaseManager(client as any);
    try {
      await mgr.getSyncHealth();
      expect(false).toBe(true); // should not reach here
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
          then: undefined,
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

    // 2 approved / (2 approved + 1 rejected) = 2/3 = 0.6666...
    expect(result.approvalRate).toBe(2 / 3);
  });

  test('confidenceDistribution bins correctly', async () => {
    const client = {
      from: () => ({
        select: () => ({
          data: [
            { status: 'pending', confidence: 0.95 }, // high
            { status: 'pending', confidence: 0.9 },  // high
            { status: 'pending', confidence: 0.85 }, // medium
            { status: 'pending', confidence: 0.7 },  // medium
            { status: 'pending', confidence: 0.65 }, // low
            { status: 'pending', confidence: 0.5 },  // low
            { status: 'pending', confidence: null }, // low (treated as 0)
          ],
          error: null,
        }),
      }),
    };

    const mgr = new SupabaseManager(client as any);
    const result = await mgr.getLearningQuality();

    expect(result.confidenceDistribution.high).toBe(2);   // >= 0.9
    expect(result.confidenceDistribution.medium).toBe(2); // 0.7-0.9
    expect(result.confidenceDistribution.low).toBe(3);    // < 0.7
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
    expect(result.pending).toBe(0);
    expect(result.approved).toBe(0);
    expect(result.rejected).toBe(0);
    expect(result.approvalRate).toBeNull();
    expect(result.confidenceDistribution.high).toBe(0);
    expect(result.confidenceDistribution.medium).toBe(0);
    expect(result.confidenceDistribution.low).toBe(0);
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
      expect(false).toBe(true); // should not reach here
    } catch (err) {
      expect((err as Error).message).toBe('Database connection failed');
    }
  });
});
