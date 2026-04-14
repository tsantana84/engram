import { Database } from 'bun:sqlite';

export interface SyncQueueItem {
  id: number;
  entity_type: 'observation' | 'session' | 'summary';
  entity_id: number;
  status: 'pending' | 'synced' | 'failed';
  attempts: number;
  created_at: string;
  synced_at: string | null;
}

export interface SyncQueueStatus {
  pending: number;
  synced: number;
  failed: number;
}

const MAX_RETRIES = 5;

export class SyncQueue {
  constructor(private db: Database, private maxRetries: number = MAX_RETRIES) {}

  enqueue(entityType: 'observation' | 'session' | 'summary', entityId: number): void {
    this.db.prepare(
      `INSERT INTO sync_queue (entity_type, entity_id, created_at) VALUES (?, ?, datetime('now'))`
    ).run(entityType, entityId);
  }

  getPending(limit: number): SyncQueueItem[] {
    return this.db.prepare(
      `SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`
    ).all(limit) as SyncQueueItem[];
  }

  markSynced(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(
      `UPDATE sync_queue SET status = 'synced', synced_at = datetime('now') WHERE id IN (${placeholders})`
    ).run(...ids);
  }

  markFailed(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(
      `UPDATE sync_queue SET attempts = attempts + 1, status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END WHERE id IN (${placeholders})`
    ).run(this.maxRetries, ...ids);
  }

  markFailedPermanently(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(
      `UPDATE sync_queue SET status = 'failed', attempts = ? WHERE id IN (${placeholders})`
    ).run(this.maxRetries, ...ids);
  }

  retryFailed(): number {
    const result = this.db.prepare(
      `UPDATE sync_queue SET status = 'pending', attempts = 0 WHERE status = 'failed'`
    ).run();
    return result.changes;
  }

  getStatus(): SyncQueueStatus {
    const counts = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM sync_queue GROUP BY status
    `).all() as { status: string; count: number }[];
    
    const result: SyncQueueStatus = { pending: 0, synced: 0, failed: 0 };
    for (const row of counts) {
      if (row.status in result) {
        result[row.status as keyof SyncQueueStatus] = row.count;
      }
    }
    return result;
  }
}