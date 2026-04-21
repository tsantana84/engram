import { describe, expect, it, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { SyncQueue } from './SyncQueue.js';

function newDb(): Database {
  const db = new Database(':memory:');
  db.run(`CREATE TABLE schema_versions (version INTEGER PRIMARY KEY, applied_at TEXT)`);
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
      synced_at TEXT,
      last_error TEXT
    )
  `);
  return db;
}

describe('getFailedItems', () => {
  let db: Database;
  let q: SyncQueue;

  beforeEach(() => {
    db = newDb();
    // maxRetries=1 so a single markFailed call transitions status to 'failed'
    q = new SyncQueue(db, 1);
  });

  it('returns failed items with last_error', async () => {
    q.enqueue('observation', 42);
    const pending = q.getPending(10);
    expect(pending.length).toBe(1);

    const id = pending[0].id;
    q.markFailed([id], 'connection refused');

    const failed = q.getFailedItems(10);
    expect(failed.length).toBe(1);
    expect(failed[0].id).toBe(id);
    expect(failed[0].type).toBe('observation');
    expect(failed[0].lastError).toBe('connection refused');
  });

  it('lastError is null when markFailed called without error message', async () => {
    q.enqueue('session', 7);
    const pending = q.getPending(10);
    const id = pending[0].id;
    q.markFailed([id]);

    const failed = q.getFailedItems(10);
    expect(failed.length).toBe(1);
    expect(failed[0].lastError).toBeNull();
  });

  it('returns empty array when no failed items exist', () => {
    q.enqueue('summary', 1);
    const failed = q.getFailedItems(10);
    expect(failed.length).toBe(0);
  });

  it('respects the limit parameter', () => {
    // Insert 3 items and fail them all
    q.enqueue('observation', 1);
    q.enqueue('observation', 2);
    q.enqueue('observation', 3);
    const pending = q.getPending(10);
    const ids = pending.map((r) => r.id);
    q.markFailed(ids, 'timeout');

    const failed = q.getFailedItems(2);
    expect(failed.length).toBe(2);
  });

  it('retries field equals attempts count', () => {
    q.enqueue('observation', 99);
    const pending = q.getPending(10);
    const id = pending[0].id;
    q.markFailed([id], 'err');

    const failed = q.getFailedItems(10);
    expect(failed[0].retries).toBe(1);
  });
});
