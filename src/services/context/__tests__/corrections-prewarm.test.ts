import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../../sqlite/SessionStore.js';

describe('corrections prewarm query', () => {
  let store: SessionStore;
  beforeEach(() => { store = new SessionStore(':memory:'); });
  afterEach(() => { store.close(); });

  it('fetches corrections for project', () => {
    store.db.prepare(`
      INSERT INTO corrections (tried, wrong_because, fix, trigger_context, project, created_at)
      VALUES ('rm -rf', 'destructive', 'use trash', 'deleting files', '/my/project', ?)
    `).run(Date.now());

    const rows = store.db.prepare(`
      SELECT tried, wrong_because, fix, trigger_context
      FROM corrections
      WHERE project = ? AND trigger_context != ''
      ORDER BY weight_multiplier DESC, created_at DESC
      LIMIT 10
    `).all('/my/project') as any[];

    expect(rows.length).toBe(1);
    expect(rows[0].tried).toBe('rm -rf');
  });

  it('excludes corrections from other projects', () => {
    store.db.prepare(`
      INSERT INTO corrections (tried, wrong_because, fix, trigger_context, project, created_at)
      VALUES ('x', 'y', 'z', 'some context', '/other/project', ?)
    `).run(Date.now());

    const rows = store.db.prepare(`
      SELECT * FROM corrections WHERE project = ? AND trigger_context != ''
    `).all('/my/project') as any[];

    expect(rows.length).toBe(0);
  });
});
