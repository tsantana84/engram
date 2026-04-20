import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../../../src/services/sqlite/migrations/runner.js';

describe('Migration 26: sync_queue table', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    const runner = new MigrationRunner(db);
    runner.runAllMigrations();
  });

  afterEach(() => {
    db.close();
  });

  it('should create sync_queue table with correct columns', () => {
    const columns = db.prepare("PRAGMA table_info('sync_queue')").all();
    const columnNames = (columns as any[]).map((c) => c.name);
    
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('entity_type');
    expect(columnNames).toContain('entity_id');
    expect(columnNames).toContain('status');
    expect(columnNames).toContain('attempts');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('synced_at');
  });

  it('should be idempotent (safe to run twice)', () => {
    const runner = new MigrationRunner(db);
    runner.runAllMigrations();
    
    const version = db.prepare('SELECT version FROM schema_versions WHERE version = 27').get();
    expect(version).toBeTruthy();
  });

  it('should default status to pending and attempts to 0', () => {
    db.prepare(`
      INSERT INTO sync_queue (entity_type, entity_id, created_at)
      VALUES ('observation', 1, datetime('now'))
    `).run();
    
    const row = db.prepare('SELECT status, attempts FROM sync_queue WHERE id = 1').get() as any;
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(0);
  });

  it('should enforce entity_type check constraint', () => {
    try {
      db.prepare(`
        INSERT INTO sync_queue (entity_type, entity_id, created_at)
        VALUES ('invalid_type', 1, datetime('now'))
      `).run();
      // If we get here, constraint wasn't enforced (shouldn't happen with bun:sqlite)
      expect(false).toBe(true);
    } catch (err: any) {
      // CHECK constraint failed - this is the expected behavior
      expect(err.message).toContain('CHECK constraint failed');
    }
    
    const columns = db.prepare("PRAGMA table_info('sync_queue')").all();
    const columnNames = (columns as any[]).map((c) => c.name);
    expect(columnNames).toContain('entity_type');
  });

  it('should create indexes on sync_queue table', () => {
    const indexes = db.prepare("PRAGMA index_list('sync_queue')").all() as any[];
    const indexNames = indexes.map((i) => i.name);
    
    expect(indexNames.some((n: string) => n.includes('status'))).toBe(true);
    expect(indexNames.some((n: string) => n.includes('entity'))).toBe(true);
  });
});