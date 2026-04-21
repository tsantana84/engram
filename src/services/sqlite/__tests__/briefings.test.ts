import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { logger } from '../../../utils/logger.js';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../migrations/runner.js';
import { BriefingStore } from '../Briefings.js';

describe('session_briefings migration', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    const runner = new MigrationRunner(db);
    runner.runAllMigrations();
  });

  afterEach(() => { db.close(); });

  test('creates session_briefings table with required columns', () => {
    const cols = db.query(`PRAGMA table_info(session_briefings)`).all() as any[];
    const names = cols.map(c => c.name);
    expect(names).toContain('id');
    expect(names).toContain('memory_session_id');
    expect(names).toContain('project');
    expect(names).toContain('briefing_text');
    expect(names).toContain('trigger');
    expect(names).toContain('consumed_at');
    expect(names).toContain('created_at');
  });

  test('trigger column defaults to pre_compact', () => {
    const cols = db.query(`PRAGMA table_info(session_briefings)`).all() as any[];
    const trigger = cols.find(c => c.name === 'trigger');
    expect(trigger?.dflt_value).toBe("'pre_compact'");
  });
});

describe('BriefingStore', () => {
  let db: Database;
  let store: BriefingStore;

  beforeEach(() => {
    db = new Database(':memory:');
    new MigrationRunner(db).runAllMigrations();
    store = new BriefingStore(db);
  });

  afterEach(() => { db.close(); });

  test('store() inserts a row and returns id', () => {
    const id = store.store({ memorySessionId: 'sess-1', project: '/my/proj', briefingText: 'Active task: fix bug' });
    expect(id).toBeGreaterThan(0);
  });

  test('getPendingAndConsume() returns latest unconsumed briefing and marks it consumed', () => {
    const now = Math.floor(Date.now() / 1000);
    db.run(
      `INSERT INTO session_briefings (memory_session_id, project, briefing_text, created_at)
       VALUES ('sess-1', '/my/proj', 'first', ?)`,
      [now]
    );
    db.run(
      `INSERT INTO session_briefings (memory_session_id, project, briefing_text, created_at)
       VALUES ('sess-1', '/my/proj', 'second', ?)`,
      [now + 1]
    );

    const briefing = store.getPendingAndConsume('/my/proj');
    expect(briefing?.briefingText).toBe('second'); // latest wins

    // second call returns the other unconsumed briefing
    const again = store.getPendingAndConsume('/my/proj');
    expect(again?.briefingText).toBe('first');

    // third call returns null (all consumed)
    const third = store.getPendingAndConsume('/my/proj');
    expect(third).toBeNull();
  });

  test('getPendingAndConsume() returns null when no unconsumed briefing', () => {
    const result = store.getPendingAndConsume('/my/proj');
    expect(result).toBeNull();
  });

  test('cleanup() deletes unconsumed rows older than 7 days', () => {
    const sevenDaysAgoSec = Math.floor(Date.now() / 1000) - 7 * 24 * 3600 - 1;
    db.run(
      `INSERT INTO session_briefings (memory_session_id, project, briefing_text, created_at)
       VALUES ('sess-old', '/old', 'stale', ?)`,
      [sevenDaysAgoSec]
    );
    store.store({ memorySessionId: 'sess-new', project: '/new', briefingText: 'fresh' });

    const deleted = store.cleanup();
    expect(deleted).toBe(1);

    const remaining = db.query(`SELECT COUNT(*) as n FROM session_briefings`).get() as any;
    expect(remaining.n).toBe(1);
  });
});
