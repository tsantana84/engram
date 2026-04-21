import type { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

export interface StoreBriefingInput {
  memorySessionId: string;
  project: string;
  briefingText: string;
}

export interface BriefingRow {
  id: number;
  memorySessionId: string;
  project: string;
  briefingText: string;
  trigger: string;
  consumedAt: number | null;
  createdAt: number;
}

export class BriefingStore {
  constructor(private db: Database) {}

  store(input: StoreBriefingInput): number {
    const result = this.db.run(
      `INSERT INTO session_briefings (memory_session_id, project, briefing_text)
       VALUES (?, ?, ?)`,
      [input.memorySessionId, input.project, input.briefingText]
    );
    return result.lastInsertRowid as number;
  }

  getPendingAndConsume(project: string): BriefingRow | null {
    // Atomic: select latest unconsumed + mark consumed in one transaction
    return this.db.transaction(() => {
      const row = this.db.query<any, [string]>(
        `SELECT id, memory_session_id, project, briefing_text, trigger, consumed_at, created_at
         FROM session_briefings
         WHERE project = ? AND consumed_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1`
      ).get(project);

      if (!row) return null;

      this.db.run(
        `UPDATE session_briefings SET consumed_at = unixepoch() WHERE id = ?`,
        [row.id]
      );

      return {
        id: row.id,
        memorySessionId: row.memory_session_id,
        project: row.project,
        briefingText: row.briefing_text,
        trigger: row.trigger,
        consumedAt: null,
        createdAt: row.created_at,
      };
    })();
  }

  // Returns count of deleted rows. Called by existing worker cleanup job.
  cleanup(): number {
    const sevenDaysAgoSec = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
    const result = this.db.run(
      `DELETE FROM session_briefings
       WHERE consumed_at IS NULL AND created_at < ?`,
      [sevenDaysAgoSec]
    );
    return result.changes as number;
  }
}
