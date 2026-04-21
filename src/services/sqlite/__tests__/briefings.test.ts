import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../migrations/runner.js';

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
