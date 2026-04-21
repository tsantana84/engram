import { describe, expect, test, beforeEach } from 'bun:test';
import { SessionStore, type TickRecord } from '../SessionStore.js';

function makeRecord(overrides: Partial<TickRecord> = {}): TickRecord {
  return {
    agent_name: 'test-agent',
    duration_ms: 123,
    sessions_extracted: 0,
    learnings_enqueued: 0,
    items_pushed: 5,
    items_failed: 0,
    queue_depth_after: 0,
    errors: [],
    ...overrides,
  };
}

describe('tick_log migration and methods', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore(':memory:');
  });

  test('tick_log table is created by migration 33', () => {
    const rows = store.db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='tick_log'`
    ).all();
    expect(rows).toHaveLength(1);
  });

  test('insertTickLog stores a record', () => {
    store.insertTickLog(makeRecord({ items_pushed: 7, agent_name: 'thiago' }));
    const rows = store.db.prepare('SELECT * FROM tick_log').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].agent_name).toBe('thiago');
    expect(rows[0].items_pushed).toBe(7);
  });

  test('insertTickLog serializes errors as JSON', () => {
    store.insertTickLog(makeRecord({ errors: ['err1', 'err2'] }));
    const row = store.db.prepare('SELECT errors FROM tick_log').get() as { errors: string };
    expect(JSON.parse(row.errors)).toEqual(['err1', 'err2']);
  });

  test('insertTickLog stores null errors when array is empty', () => {
    store.insertTickLog(makeRecord({ errors: [] }));
    const row = store.db.prepare('SELECT errors FROM tick_log').get() as { errors: string | null };
    expect(row.errors).toBeNull();
  });

  test('getTickLog returns records newest-first', () => {
    store.insertTickLog(makeRecord({ duration_ms: 10 }));
    store.insertTickLog(makeRecord({ duration_ms: 20 }));
    store.insertTickLog(makeRecord({ duration_ms: 30 }));
    const ticks = store.getTickLog(10);
    expect(ticks[0].duration_ms).toBe(30);
    expect(ticks[2].duration_ms).toBe(10);
  });

  test('getTickLog respects limit', () => {
    for (let i = 0; i < 5; i++) store.insertTickLog(makeRecord());
    expect(store.getTickLog(3)).toHaveLength(3);
  });

  test('getTickLog returns empty array when no ticks', () => {
    expect(store.getTickLog(100)).toEqual([]);
  });

  test('retention: keeps at most 1000 rows', () => {
    for (let i = 0; i < 1005; i++) {
      store.insertTickLog(makeRecord({ duration_ms: i }));
    }
    const count = (store.db.prepare('SELECT COUNT(*) as n FROM tick_log').get() as { n: number }).n;
    expect(count).toBeLessThanOrEqual(1000);
  });
});
