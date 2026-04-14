import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../../../src/services/sqlite/migrations/runner.js';
import { SyncQueue } from '../../../src/services/sync/SyncQueue.js';

describe('SyncQueue', () => {
  let db: Database;
  let queue: SyncQueue;

  beforeEach(() => {
    db = new Database(':memory:');
    const runner = new MigrationRunner(db);
    runner.runAllMigrations();
    queue = new SyncQueue(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should enqueue an observation', () => {
    queue.enqueue('observation', 42);
    const pending = queue.getPending(10);
    expect(pending).toHaveLength(1);
    expect(pending[0].entity_type).toBe('observation');
    expect(pending[0].entity_id).toBe(42);
    expect(pending[0].status).toBe('pending');
  });

  it('should enqueue a session', () => {
    queue.enqueue('session', 1);
    const pending = queue.getPending(10);
    expect(pending).toHaveLength(1);
    expect(pending[0].entity_type).toBe('session');
  });

  it('should enqueue a summary', () => {
    queue.enqueue('summary', 5);
    const pending = queue.getPending(10);
    expect(pending[0].entity_type).toBe('summary');
  });

  it('should respect batch limit in getPending', () => {
    for (let i = 0; i < 150; i++) {
      queue.enqueue('observation', i);
    }
    const batch = queue.getPending(100);
    expect(batch).toHaveLength(100);
  });

  it('should mark items as synced', () => {
    queue.enqueue('observation', 42);
    const pending = queue.getPending(10);
    queue.markSynced([pending[0].id]);
    
    const remaining = queue.getPending(10);
    expect(remaining).toHaveLength(0);
  });

  it('should mark items as failed and increment attempts', () => {
    queue.enqueue('observation', 42);
    const pending = queue.getPending(10);
    queue.markFailed([pending[0].id]);
    
    const updated = db.prepare('SELECT attempts, status FROM sync_queue WHERE id = ?').get(pending[0].id) as any;
    expect(updated.attempts).toBe(1);
    expect(updated.status).toBe('pending');
  });

  it('should mark items as permanently failed after max retries', () => {
    queue.enqueue('observation', 42);
    const pending = queue.getPending(10);
    
    for (let i = 0; i < 5; i++) {
      queue.markFailed([pending[0].id]);
    }
    
    const updated = db.prepare('SELECT attempts, status FROM sync_queue WHERE id = ?').get(pending[0].id) as any;
    expect(updated.attempts).toBe(5);
    expect(updated.status).toBe('failed');
  });

  it('should not return failed items in getPending', () => {
    queue.enqueue('observation', 42);
    const pending = queue.getPending(10);
    for (let i = 0; i < 5; i++) {
      queue.markFailed([pending[0].id]);
    }
    
    const remaining = queue.getPending(10);
    expect(remaining).toHaveLength(0);
  });

  it('should retry failed items', () => {
    queue.enqueue('observation', 42);
    const pending = queue.getPending(10);
    for (let i = 0; i < 5; i++) {
      queue.markFailed([pending[0].id]);
    }
    
    const retried = queue.retryFailed();
    expect(retried).toBe(1);
    
    const nowPending = queue.getPending(10);
    expect(nowPending).toHaveLength(1);
    expect(nowPending[0].attempts).toBe(0);
  });

  it('should return queue status counts', () => {
    queue.enqueue('observation', 1);
    queue.enqueue('observation', 2);
    queue.enqueue('observation', 3);
    
    const pending = queue.getPending(1);
    queue.markSynced([pending[0].id]);
    
    const status = queue.getStatus();
    expect(status.pending).toBe(2);
    expect(status.synced).toBe(1);
    expect(status.failed).toBe(0);
  });

  it('should handle empty queue gracefully', () => {
    const pending = queue.getPending(10);
    expect(pending).toHaveLength(0);
    
    const status = queue.getStatus();
    expect(status.pending).toBe(0);
    expect(status.synced).toBe(0);
    expect(status.failed).toBe(0);
  });

  it('should handle markSynced with empty array', () => {
    queue.markSynced([]);
    const status = queue.getStatus();
    expect(status.synced).toBe(0);
  });

  it('should handle markFailed with empty array', () => {
    queue.markFailed([]);
    const status = queue.getStatus();
    expect(status.pending).toBe(0);
  });
});