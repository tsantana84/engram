import { Database } from 'bun:sqlite';
import type { LearningPayload, LearningTargetStatus } from './learning-types.js';
import { logger } from '../../utils/logger.js';

export interface SyncQueueItem {
  id: number;
  entity_type: 'observation' | 'session' | 'summary' | 'learning';
  entity_id: number;
  target_status: LearningTargetStatus | null;
  payload: LearningPayload | null;
  status: 'pending' | 'synced' | 'failed' | 'permanently_failed';
  attempts: number;
  created_at_epoch: number;
}

export interface SyncQueueStatus {
  pending: number;
  synced: number;
  failed: number;
  permanently_failed: number;
}

const MAX_RETRIES = 5;

// Learnings have no separate storage table; entity_id is a sentinel (0) because the
// full LearningPayload lives in the `payload` column instead.
const LEARNING_ENTITY_ID_SENTINEL = 0;

export class SyncQueue {
  constructor(private db: Database, private maxRetries: number = MAX_RETRIES) {}

  enqueue(entityType: 'observation' | 'session' | 'summary', entityId: number): void {
    this.db.prepare(
      `INSERT INTO sync_queue (entity_type, entity_id, created_at) VALUES (?, ?, datetime('now'))`
    ).run(entityType, entityId);
  }

  enqueueLearning(payload: LearningPayload, targetStatus: LearningTargetStatus): void {
    this.db.run(
      'INSERT INTO sync_queue (entity_type, entity_id, target_status, payload) VALUES (?, ?, ?, ?)',
      ['learning', LEARNING_ENTITY_ID_SENTINEL, targetStatus, JSON.stringify(payload)]
    );
  }

  getPending(limit: number): SyncQueueItem[] {
    const rows = this.db
      .query<{
        id: number; entity_type: string; entity_id: number;
        target_status: string | null; payload: string | null;
        attempts: number; status: string; created_at: string;
      }, [number]>(
        `SELECT id, entity_type, entity_id, target_status, payload, attempts, status, created_at
         FROM sync_queue WHERE status = 'pending' ORDER BY id ASC LIMIT ?`
      )
      .all(limit);
    return rows.map((r) => ({
      id: r.id,
      entity_type: r.entity_type as SyncQueueItem['entity_type'],
      entity_id: r.entity_id,
      target_status: (r.target_status as LearningTargetStatus | null) ?? null,
      payload: r.payload ? (JSON.parse(r.payload) as LearningPayload) : null,
      attempts: r.attempts,
      status: r.status as SyncQueueItem['status'],
      created_at_epoch: r.created_at ? new Date(r.created_at).getTime() : 0,
    }));
  }

  markSynced(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(
      `UPDATE sync_queue SET status = 'synced', synced_at = datetime('now') WHERE id IN (${placeholders})`
    ).run(...ids);
  }

  markFailed(ids: number[], errorMsg?: string): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    if (errorMsg !== undefined) {
      this.db.prepare(
        `UPDATE sync_queue SET attempts = attempts + 1, last_error = ?, status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END WHERE id IN (${placeholders})`
      ).run(errorMsg, this.maxRetries, ...ids);
    } else {
      this.db.prepare(
        `UPDATE sync_queue SET attempts = attempts + 1, status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END WHERE id IN (${placeholders})`
      ).run(this.maxRetries, ...ids);
    }
  }

  getFailedItems(limit: number): Array<{
    id: number;
    type: string;
    retries: number;
    lastError: string | null;
  }> {
    return this.db.prepare(
      `SELECT id, entity_type as type, attempts as retries, last_error as lastError
       FROM sync_queue WHERE status = 'failed'
       ORDER BY created_at DESC LIMIT ?`
    ).all(limit) as Array<{ id: number; type: string; retries: number; lastError: string | null }>;
  }

  markFailedPermanently(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(
      `UPDATE sync_queue SET status = 'permanently_failed', attempts = ? WHERE id IN (${placeholders})`
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

    const result: SyncQueueStatus = { pending: 0, synced: 0, failed: 0, permanently_failed: 0 };
    for (const row of counts) {
      if (row.status in result) {
        result[row.status as keyof SyncQueueStatus] = row.count;
      }
    }
    return result;
  }
}
