import { describe, expect, test } from 'bun:test';
import { SupabaseManager } from '../SupabaseManager.js';

function mockClient() {
  const queryBuilder = {
    insert: (row: any) => ({ select: () => ({ single: async () => ({ data: { id: 101, ...row }, error: null }) }) }),
    upsert: (row: any, _opts: any) => ({ select: () => ({ single: async () => ({ data: { id: 101, ...row }, error: null }) }) }),
    select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: [{ id: 1, claim: 'x' }], error: null }) }) }) }),
    update: (patch: any) => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { id: 101, ...patch }, error: null }) }) }) }),
  };
  const from = (_table: string) => queryBuilder;
  return { from };
}

describe('SupabaseManager learnings methods', () => {
  test('insertLearning stores row with target status', async () => {
    const mgr = new SupabaseManager(mockClient() as any);
    const out = await mgr.insertLearning({
      claim: 'c', evidence: null, scope: null, confidence: 0.9,
      project: 'p', source_session: 's', content_hash: 'h', source_agent_id: 'agent-1',
    }, 'approved');
    expect(out.id).toBe(101);
  });

  test('listLearnings filters by status', async () => {
    const mgr = new SupabaseManager(mockClient() as any);
    const rows = await mgr.listLearnings({ status: 'pending', limit: 50, offset: 0 });
    expect(rows.length).toBe(1);
  });

  test('reviewLearning sets reviewed_at + reviewer', async () => {
    const mgr = new SupabaseManager(mockClient() as any);
    const out = await mgr.reviewLearning(42, {
      status: 'approved',
      reviewed_by: 'agent-key-xyz',
    });
    expect(out.status).toBe('approved');
  });

  test('insertLearning returns dedupe_noop when upsert returns PGRST116', async () => {
    const client = {
      from: () => ({
        upsert: () => ({
          select: () => ({
            single: async () => ({ data: null, error: { code: 'PGRST116' } }),
          }),
        }),
      }),
    };
    const mgr = new SupabaseManager(client as any);
    const out = await mgr.insertLearning({
      claim: 'c', evidence: null, scope: null, confidence: 0.9,
      project: 'p', source_session: 's', content_hash: 'h', source_agent_id: 'agent-1',
    }, 'approved');
    expect(out.action).toBe('dedupe_noop');
    expect(out.id).toBeUndefined();
  });
});
