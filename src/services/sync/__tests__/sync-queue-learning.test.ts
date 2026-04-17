import { describe, expect, test, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { SyncQueue } from '../SyncQueue.js';
import type { LearningPayload } from '../learning-types.js';

function newDb(): Database {
  const db = new Database(':memory:');
  db.run(`CREATE TABLE schema_versions (version INTEGER PRIMARY KEY, applied_at TEXT)`);
  // Mirror the post-migration-30 shape so SyncQueue can operate without DDL.
  db.run(`
    CREATE TABLE sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('observation','session','summary','learning')),
      entity_id INTEGER NOT NULL,
      target_status TEXT,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','synced','failed','permanently_failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at TEXT
    )
  `);
  return db;
}

function samplePayload(): LearningPayload {
  return {
    claim: 'c', evidence: 'e', scope: 's', confidence: 0.9,
    project: 'p', source_session: 'sess-1', content_hash: 'h1',
  };
}

describe('SyncQueue — learning entity type', () => {
  let db: Database;
  let q: SyncQueue;

  beforeEach(() => {
    db = newDb();
    q = new SyncQueue(db);
  });

  test('enqueueLearning stores payload + target_status', () => {
    const payload = samplePayload();
    q.enqueueLearning(payload, 'approved');
    const pending = q.getPending(10);
    expect(pending.length).toBe(1);
    expect(pending[0].entity_type).toBe('learning');
    expect(pending[0].target_status).toBe('approved');
    expect(pending[0].payload).toEqual(payload);
  });

  test('pending learnings carry pending status too', () => {
    q.enqueueLearning(samplePayload(), 'pending');
    const pending = q.getPending(10);
    expect(pending[0].target_status).toBe('pending');
  });

  test('getStatus counts permanently_failed rows separately', () => {
    q.enqueueLearning(samplePayload(), 'approved');
    q.enqueueLearning(samplePayload(), 'approved');
    const pending = q.getPending(10);
    const ids = pending.map((r) => r.id);

    // Mark one permanently failed via the public API (approach b — fixes the write bug)
    q.markFailedPermanently([ids[0]]);

    const status = q.getStatus();
    expect(status.permanently_failed).toBe(1);
    expect(status.pending).toBe(1);
    expect(status.failed).toBe(0);
  });

  test('payload roundtrip preserves null optional fields', () => {
    const payload: LearningPayload = {
      claim: 'c', evidence: null, scope: null, confidence: 0.5,
      project: 'p', source_session: 'sess-2', content_hash: 'h2',
    };
    q.enqueueLearning(payload, 'approved');
    const pending = q.getPending(10);
    expect(pending[0].payload).toEqual(payload);
    expect(pending[0].payload?.evidence).toBeNull();
    expect(pending[0].payload?.scope).toBeNull();
  });
});
