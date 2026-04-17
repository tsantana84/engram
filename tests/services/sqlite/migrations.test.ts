import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../../../src/services/sqlite/migrations/runner.js';

describe('migration 28 — provenance columns', () => {
  it('adds git_branch, invalidated_at, validation_status columns', () => {
    const db = new Database(':memory:');
    const runner = new MigrationRunner(db);
    runner.runAllMigrations();
    const cols = (db.prepare("PRAGMA table_info(observations)").all() as any[]).map((c: any) => c.name);
    expect(cols).toContain('git_branch');
    expect(cols).toContain('invalidated_at');
    expect(cols).toContain('validation_status');
  });
});
