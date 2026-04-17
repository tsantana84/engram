# Learning Extraction Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-observation server sync with a session-end LLM-extracted pipeline that produces structured learnings (`claim, evidence, scope, confidence`), auto-syncs high-confidence ones to the canonical team corpus, and quarantines low-confidence ones in a shared web dashboard for engineer review.

**Architecture:** SessionEnd hook + worker sweep triggers `LearningExtractor` (injectable LLM closure). A confidence threshold splits outputs into two target statuses. Both batches push through the existing `SyncQueue` → `SyncClient` → Vercel API path. The server inserts rows into a new `learnings` table. High-confidence and engineer-approve paths run a server-side port of the existing `ConflictDetector`. A minimal Vercel-hosted dashboard reads/writes learnings via new API routes.

**Tech Stack:** TypeScript, Bun, SQLite (`bun:sqlite`), Supabase (PostgreSQL), Vercel Serverless Functions (`@vercel/node`), Express (worker service), Node-compatible fetch.

**Spec reference:** [`docs/superpowers/specs/2026-04-16-learning-extraction-pipeline-design.md`](../specs/2026-04-16-learning-extraction-pipeline-design.md)

---

## File Map

| Layer | Path | Responsibility |
|---|---|---|
| Local types | `src/services/sync/learning-types.ts` | Shared `ExtractedLearning`, `LearningPayload`, `LearningPushRequest`, `LearningPushResponse`, `LearningReviewAction` types. |
| Local migration | `src/services/sqlite/SessionStore.ts` | New migration 29: `extraction_status`, `extraction_attempts` columns on `sdk_sessions`. |
| Local queue | `src/services/sync/SyncQueue.ts` | Widen `entity_type` union to include `'learning'` + `target_status` payload column. |
| Local extractor | `src/services/sync/LearningExtractor.ts` | LLM-backed extractor. Returns `ExtractedLearning[]`. |
| Local worker | `src/services/sync/SyncWorker.ts` | New `extractSessionLearnings()` method + reworked `tick()` path. Legacy observation push gated behind feature flag. |
| Local client | `src/services/sync/SyncClient.ts` | New `pushLearnings()` method. |
| Local hooks | `src/hooks/session-end.ts` | Mark `extraction_status='pending'` on close. |
| Local worker svc | `src/services/worker-service.ts` | Construct `llm` closure from settings; inject into `LearningExtractor` + existing `ConflictDetector`. |
| Local settings | `src/shared/settings.ts` (or current settings module) | New keys for extraction + threshold + retries. |
| Server schema | `supabase/migrations/20260416_learnings_table.sql` | `learnings` table + indexes + unique constraint. |
| Server lib | `api/lib/SupabaseManager.ts` | New `insertLearning`, `listLearnings`, `getLearning`, `reviewLearning` methods. |
| Server shared | `api/lib/conflict-prompt.ts` | Shared prompt text (factored from existing `ConflictDetector`). |
| Server detector | `api/lib/ConflictDetector.ts` | Server port of the client-side detector, uses `SupabaseManager.fetchSimilarLearnings`. |
| Server API | `api/sync/learnings.ts` | `POST /api/sync/learnings` (ingest path). |
| Server API | `api/learnings/index.ts` | `GET /api/learnings` (list, filter by status/project). |
| Server API | `api/learnings/[id].ts` | `GET /api/learnings/:id` (detail). |
| Server API | `api/learnings/[id]/review.ts` | `POST /api/learnings/:id/review` (approve / reject / edit_approve). |
| Dashboard | `public/dashboard/index.html` | Minimal single-page app (served via Vercel zero-config `public/`). |
| Dashboard | `public/dashboard/app.js` | Fetch + render + review actions. **Uses DOM methods only (no innerHTML).** |
| Dashboard | `public/dashboard/styles.css` | Minimal styling. |
| Docs | `docs/public/features/learning-extraction.mdx` | User-facing feature doc (Mintlify). |

---

## Conventions

- **TDD loop:** failing test → run (observe failure) → minimal implementation → run (observe pass) → commit. Skip this only for migration SQL and static asset files.
- **Test runner:** `bun test` (matches repo convention).
- **Commits:** one per task, Conventional Commits prefix (`feat:`, `test:`, `docs:`, `chore:`). Include `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer only when the agent's working guidance asks for it.
- **Do not edit generated files.** The changelog is generated automatically — do not modify `CHANGELOG.md`.
- **Feature flag:** all client behavior changes live behind `CLAUDE_MEM_LEARNING_EXTRACTION_ENABLED`. Default `true` once Task 16 lands; until then, leave off.
- **XSS safety:** all dashboard DOM rendering uses `textContent` and `createElement` — never `innerHTML` with interpolated server data.
- **After each implementation task, run:** `bun test` (full suite) to catch regressions.

---

## Task 1: Shared learning types module

**Files:**
- Create: `src/services/sync/learning-types.ts`
- Test: `src/services/sync/__tests__/learning-types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/sync/__tests__/learning-types.test.ts
import { describe, expect, test } from 'bun:test';
import type {
  ExtractedLearning,
  LearningPayload,
  LearningPushRequest,
  LearningReviewAction,
} from '../learning-types.js';

describe('learning-types', () => {
  test('ExtractedLearning has claim, evidence, scope, confidence', () => {
    const l: ExtractedLearning = {
      claim: 'Queue retries at 5s intervals.',
      evidence: 'SyncQueue.ts sets RETRY_DELAY = 5000',
      scope: 's',
      confidence: 0.9,
    };
    expect(l.confidence).toBe(0.9);
  });

  test('LearningPushRequest requires target_status', () => {
    const req: LearningPushRequest = {
      learnings: [],
      target_status: 'approved',
    };
    expect(req.target_status).toBe('approved');
  });

  test('LearningReviewAction union covers all three actions', () => {
    const approve: LearningReviewAction = { action: 'approve' };
    const reject: LearningReviewAction = { action: 'reject', rejection_reason: 'duplicate' };
    const edit: LearningReviewAction = {
      action: 'edit_approve',
      edited: { claim: 'refined claim' },
    };
    expect([approve.action, reject.action, edit.action]).toEqual(['approve', 'reject', 'edit_approve']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/sync/__tests__/learning-types.test.ts`
Expected: FAIL — `Cannot find module '../learning-types.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/services/sync/learning-types.ts
export interface ExtractedLearning {
  claim: string;
  evidence: string | null;
  scope: string | null;
  confidence: number; // 0.0–1.0
}

export interface LearningPayload extends ExtractedLearning {
  project: string;
  source_session: string;
  content_hash: string;
}

export type LearningTargetStatus = 'approved' | 'pending';

export interface LearningPushRequest {
  learnings: LearningPayload[];
  target_status: LearningTargetStatus;
}

export interface LearningPushResult {
  content_hash: string;
  id?: number;
  action: 'inserted' | 'dedupe_noop' | 'invalidated_target' | 'updated_target';
  error?: string;
}

export interface LearningPushResponse {
  results: LearningPushResult[];
}

export type LearningReviewAction =
  | { action: 'approve' }
  | { action: 'reject'; rejection_reason?: string }
  | { action: 'edit_approve'; edited: Partial<Pick<LearningPayload, 'claim' | 'evidence' | 'scope'>> };

export interface LearningRecord extends LearningPayload {
  id: number;
  status: 'pending' | 'approved' | 'rejected';
  invalidated: boolean;
  invalidated_by: number | null;
  extracted_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  edit_diff: Record<string, unknown> | null;
  rejection_reason: string | null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/services/sync/__tests__/learning-types.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/sync/learning-types.ts src/services/sync/__tests__/learning-types.test.ts
git commit -m "feat(sync): add learning-types module"
```

---

## Task 2: Local SQLite migration 29 — extraction status columns

**Files:**
- Modify: `src/services/sqlite/SessionStore.ts` (add migration 29 method, call in `initializeSchema`)
- Test: `src/services/sqlite/__tests__/extraction-columns.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/sqlite/__tests__/extraction-columns.test.ts
import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { SessionStore } from '../SessionStore.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('SessionStore migration 29 — extraction_status columns', () => {
  let tmp: string;
  let dbPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'engram-test-'));
    dbPath = join(tmp, 'test.db');
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  test('adds extraction_status and extraction_attempts columns to sdk_sessions', () => {
    const store = new SessionStore(dbPath);
    const db = new Database(dbPath);
    const cols = db.query<{ name: string }, []>("PRAGMA table_info('sdk_sessions')").all();
    const names = cols.map((c) => c.name);
    expect(names).toContain('extraction_status');
    expect(names).toContain('extraction_attempts');
    store.close();
    db.close();
  });

  test('extraction_status defaults to "pending"', () => {
    const store = new SessionStore(dbPath);
    const memoryId = `test-${Date.now()}`;
    const sessionId = store.createSDKSession(memoryId, 'test-proj', 'hello');
    const db = new Database(dbPath);
    const row = db.query<{ extraction_status: string; extraction_attempts: number }, [number]>(
      'SELECT extraction_status, extraction_attempts FROM sdk_sessions WHERE id = ?'
    ).get(sessionId);
    expect(row?.extraction_status).toBe('pending');
    expect(row?.extraction_attempts).toBe(0);
    store.close();
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/sqlite/__tests__/extraction-columns.test.ts`
Expected: FAIL — columns not present.

- [ ] **Step 3: Add migration method and call it**

Add in `SessionStore.ts` alongside the other `addXxxColumn` migrations (version **29**):

```ts
/** Add extraction pipeline tracking columns to sdk_sessions (migration 29) */
private addExtractionStatusColumns(): void {
  const version = 29;
  const already = this.db
    .query<{ count: number }, [number]>('SELECT COUNT(*) as count FROM schema_versions WHERE version = ?')
    .get(version);
  if ((already?.count ?? 0) > 0) return;

  const cols = this.db
    .query<{ name: string }, []>("PRAGMA table_info('sdk_sessions')")
    .all()
    .map((c) => c.name);

  if (!cols.includes('extraction_status')) {
    this.db.run(
      "ALTER TABLE sdk_sessions ADD COLUMN extraction_status TEXT NOT NULL DEFAULT 'pending'"
    );
  }
  if (!cols.includes('extraction_attempts')) {
    this.db.run(
      'ALTER TABLE sdk_sessions ADD COLUMN extraction_attempts INTEGER NOT NULL DEFAULT 0'
    );
  }

  this.db.run('INSERT INTO schema_versions (version) VALUES (?)', [version]);
  logger.info('Migration 29 applied: extraction_status columns on sdk_sessions');
}
```

Then register the call inside `initializeSchema()` after the existing migration 28 call:

```ts
this.addProvenanceColumns();       // existing (migration 28)
this.addExtractionStatusColumns(); // NEW migration 29
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/services/sqlite/__tests__/extraction-columns.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run full suite**

Run: `bun test`
Expected: no new failures.

- [ ] **Step 6: Commit**

```bash
git add src/services/sqlite/SessionStore.ts src/services/sqlite/__tests__/extraction-columns.test.ts
git commit -m "feat(sqlite): add extraction_status columns (migration 29)"
```

---

## Task 3: Widen SyncQueue to carry learnings with target_status

**Files:**
- Modify: `src/services/sqlite/SessionStore.ts` — new **migration 30** that widens the `sync_queue.entity_type` CHECK constraint and adds two columns.
- Modify: `src/services/sync/SyncQueue.ts` — add `enqueueLearning`, include new columns in SELECT, parse `payload` JSON.
- Test: `src/services/sync/__tests__/sync-queue-learning.test.ts`

Context: `SyncQueue` currently stores `entity_type IN ('observation','session','summary')` with a CHECK constraint owned by `SessionStore.createSyncQueueTable()` (migration 27). Learnings don't have a local integer ID. We need:
1. The CHECK constraint to include `'learning'` (SQLite requires table rebuild for CHECK changes).
2. Two new columns: `target_status TEXT`, `payload TEXT` (JSON).
3. Store `entity_id = 0` for learnings; put the `LearningPayload` JSON in `payload`.

Schema ownership stays with `SessionStore` (migration 30). `SyncQueue` performs only DML, no DDL.

- [ ] **Step 1: Write the failing test**

```ts
// src/services/sync/__tests__/sync-queue-learning.test.ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/sync/__tests__/sync-queue-learning.test.ts`
Expected: FAIL — `enqueueLearning` not defined; `target_status` / `payload` columns missing.

- [ ] **Step 3a: Add migration 30 in SessionStore**

Add method beside `createSyncQueueTable` (migration 27):

```ts
/** Widen sync_queue: add 'learning' to CHECK, add target_status + payload columns (migration 30) */
private widenSyncQueueForLearnings(): void {
  const applied = this.db
    .prepare('SELECT version FROM schema_versions WHERE version = ?')
    .get(30) as SchemaVersion | undefined;
  if (applied) return;

  // SQLite CHECK constraints can't be altered in place — rebuild the table.
  this.db.run('BEGIN');
  try {
    this.db.run(`
      CREATE TABLE sync_queue_new (
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
    this.db.run(`INSERT INTO sync_queue_new (id, entity_type, entity_id, status, attempts, created_at, synced_at)
                 SELECT id, entity_type, entity_id, status, attempts, created_at, synced_at FROM sync_queue`);
    this.db.run('DROP TABLE sync_queue');
    this.db.run('ALTER TABLE sync_queue_new RENAME TO sync_queue');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_type, entity_id)');
    this.db
      .prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)')
      .run(30, new Date().toISOString());
    this.db.run('COMMIT');
    logger.info('Migration 30 applied: sync_queue widened for learnings');
  } catch (err) {
    this.db.run('ROLLBACK');
    throw err;
  }
}
```

Call it from `initializeSchema()` right after `addExtractionStatusColumns()` (migration 29).

- [ ] **Step 3b: Extend SyncQueue (no DDL)**

Modify `src/services/sync/SyncQueue.ts`:

```ts
import { Database } from 'bun:sqlite';
import type { LearningPayload, LearningTargetStatus } from './learning-types.js';

const MAX_RETRIES = 5;

export interface SyncQueueItem {
  id: number;
  entity_type: 'observation' | 'session' | 'summary' | 'learning';
  entity_id: number;
  target_status: LearningTargetStatus | null;
  payload: LearningPayload | null;
  attempts: number;
  status: 'pending' | 'failed' | 'permanently_failed' | 'synced';
  created_at_epoch: number;
}

export interface SyncQueueStatus {
  pending: number;
  failed: number;
  permanently_failed: number;
  synced: number;
}

export class SyncQueue {
  constructor(private db: Database, private maxRetries: number = MAX_RETRIES) {}

  enqueue(entityType: 'observation' | 'session' | 'summary', entityId: number): void {
    this.db.run(
      'INSERT INTO sync_queue (entity_type, entity_id) VALUES (?, ?)',
      [entityType, entityId]
    );
  }

  enqueueLearning(payload: LearningPayload, targetStatus: LearningTargetStatus): void {
    this.db.run(
      'INSERT INTO sync_queue (entity_type, entity_id, target_status, payload) VALUES (?, 0, ?, ?)',
      ['learning', targetStatus, JSON.stringify(payload)]
    );
  }

  getPending(limit: number): SyncQueueItem[] {
    const rows = this.db
      .query<
        {
          id: number; entity_type: string; entity_id: number;
          target_status: string | null; payload: string | null;
          attempts: number; status: string; created_at_epoch: number;
        },
        [number]
      >(
        `SELECT id, entity_type, entity_id, target_status, payload, attempts, status, created_at_epoch
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
      created_at_epoch: r.created_at_epoch,
    }));
  }

  markSynced(ids: number[]): void {
    if (!ids.length) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.run(`UPDATE sync_queue SET status = 'synced' WHERE id IN (${placeholders})`, ids);
  }

  markFailed(ids: number[]): void {
    if (!ids.length) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.run(
      `UPDATE sync_queue SET status = 'failed', attempts = attempts + 1 WHERE id IN (${placeholders})`,
      ids
    );
  }

  markFailedPermanently(ids: number[]): void {
    if (!ids.length) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.run(
      `UPDATE sync_queue SET status = 'permanently_failed', attempts = attempts + 1 WHERE id IN (${placeholders})`,
      ids
    );
  }

  retryFailed(): number {
    const result = this.db.run(
      `UPDATE sync_queue SET status = 'pending'
       WHERE status = 'failed' AND attempts < ?`,
      [this.maxRetries]
    );
    return result.changes ?? 0;
  }

  getStatus(): SyncQueueStatus {
    const row = this.db
      .query<SyncQueueStatus, []>(`
        SELECT
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN status = 'permanently_failed' THEN 1 ELSE 0 END) as permanently_failed,
          SUM(CASE WHEN status = 'synced' THEN 1 ELSE 0 END) as synced
        FROM sync_queue
      `)
      .get();
    return row ?? { pending: 0, failed: 0, permanently_failed: 0, synced: 0 };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/services/sync/__tests__/sync-queue-learning.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `bun test`
Expected: no new failures. If the existing `SyncWorker.tick()` uses `getPending(...)` destructured keys, verify `observation/session/summary` items still flow through (they do — `entity_id > 0`, `payload = null`).

- [ ] **Step 6: Commit**

```bash
git add src/services/sync/SyncQueue.ts src/services/sync/__tests__/sync-queue-learning.test.ts
git commit -m "feat(sync): SyncQueue supports learning entity_type + target_status"
```

---

## Task 4: Settings — extraction keys

**Files:**
- Modify: wherever settings defaults are centralized. Search first: `rtk grep -rn "CLAUDE_MEM_SYNC_ENABLED" src/ | head` to find the defaults module.
- Test: `src/shared/__tests__/settings-learning.test.ts`

- [ ] **Step 1: Locate settings module**

Run: `rtk grep -rn "CLAUDE_MEM_SYNC_ENABLED" src/shared/ src/services/`
Expected output: one or two files — e.g. `src/shared/settings.ts` or similar. Use that file for the edits below.

- [ ] **Step 2: Write the failing test**

```ts
// src/shared/__tests__/settings-learning.test.ts
import { describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS } from '../settings.js'; // adjust import to match step 1 finding

describe('learning extraction settings defaults', () => {
  test('extraction enabled by default', () => {
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_LEARNING_EXTRACTION_ENABLED).toBe(true);
  });
  test('threshold default 0.8', () => {
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_LEARNING_CONFIDENCE_THRESHOLD).toBe(0.8);
  });
  test('max per session default 10', () => {
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_LEARNING_MAX_PER_SESSION).toBe(10);
  });
  test('max retries default 3', () => {
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_LEARNING_EXTRACTION_MAX_RETRIES).toBe(3);
  });
  test('llm model key present (string)', () => {
    expect(typeof DEFAULT_SETTINGS.CLAUDE_MEM_LEARNING_LLM_MODEL).toBe('string');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/shared/__tests__/settings-learning.test.ts`
Expected: FAIL — keys missing.

- [ ] **Step 4: Add keys to settings defaults**

Append to `DEFAULT_SETTINGS` (or equivalent):

```ts
CLAUDE_MEM_LEARNING_EXTRACTION_ENABLED: true,
CLAUDE_MEM_LEARNING_CONFIDENCE_THRESHOLD: 0.8,
CLAUDE_MEM_LEARNING_LLM_MODEL: 'claude-sonnet-4-6',
CLAUDE_MEM_LEARNING_MAX_PER_SESSION: 10,
CLAUDE_MEM_LEARNING_EXTRACTION_MAX_RETRIES: 3,
```

Also widen the settings TypeScript interface accordingly.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/shared/__tests__/settings-learning.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add <settings-file> src/shared/__tests__/settings-learning.test.ts
git commit -m "feat(settings): add learning extraction defaults"
```

---

## Task 5: LearningExtractor

**Files:**
- Create: `src/services/sync/LearningExtractor.ts`
- Test: `src/services/sync/__tests__/LearningExtractor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/sync/__tests__/LearningExtractor.test.ts
import { describe, expect, test } from 'bun:test';
import { LearningExtractor, type SessionInput } from '../LearningExtractor.js';

function session(overrides: Partial<SessionInput> = {}): SessionInput {
  return {
    sessionId: 'sess-1',
    project: 'engram',
    observations: [
      { title: 'Fixed worker readiness', narrative: 'Readiness returns 503 during init', facts: ['503 status'] },
    ],
    summary: {
      request: 'Fix readiness check',
      investigated: 'worker-service boot order',
      learned: 'Initialization must complete before readiness=200',
      next_steps: 'add regression test',
    },
    ...overrides,
  };
}

describe('LearningExtractor', () => {
  test('parses JSON array output from LLM', async () => {
    const fakeLlm = async () =>
      JSON.stringify([
        { claim: 'readiness gates on init', evidence: 'worker-service.ts', scope: 'area', confidence: 0.92 },
      ]);
    const ex = new LearningExtractor({ enabled: true, llm: fakeLlm });
    const out = await ex.extract(session());
    expect(out.length).toBe(1);
    expect(out[0].claim).toContain('readiness');
    expect(out[0].confidence).toBeCloseTo(0.92);
  });

  test('returns [] when disabled', async () => {
    const ex = new LearningExtractor({ enabled: false, llm: async () => '[]' });
    expect(await ex.extract(session())).toEqual([]);
  });

  test('returns [] on malformed JSON (does not throw)', async () => {
    const ex = new LearningExtractor({ enabled: true, llm: async () => 'totally not json' });
    expect(await ex.extract(session())).toEqual([]);
  });

  test('returns [] when LLM throws', async () => {
    const ex = new LearningExtractor({
      enabled: true,
      llm: async () => { throw new Error('boom'); },
    });
    expect(await ex.extract(session())).toEqual([]);
  });

  test('empty session input returns []', async () => {
    const ex = new LearningExtractor({ enabled: true, llm: async () => '[]' });
    const out = await ex.extract(session({ observations: [], summary: null }));
    expect(out).toEqual([]);
  });

  test('honors maxLearningsPerSession cap', async () => {
    const payload = JSON.stringify(
      Array.from({ length: 20 }, (_, i) => ({
        claim: `c${i}`, evidence: null, scope: null, confidence: 0.9,
      }))
    );
    const ex = new LearningExtractor({
      enabled: true,
      llm: async () => payload,
      maxLearningsPerSession: 5,
    });
    const out = await ex.extract(session());
    expect(out.length).toBe(5);
  });

  test('clamps confidence into [0,1]', async () => {
    const ex = new LearningExtractor({
      enabled: true,
      llm: async () =>
        JSON.stringify([
          { claim: 'a', confidence: 1.5 },
          { claim: 'b', confidence: -0.3 },
        ]),
    });
    const out = await ex.extract(session());
    expect(out[0].confidence).toBe(1);
    expect(out[1].confidence).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/sync/__tests__/LearningExtractor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement LearningExtractor**

```ts
// src/services/sync/LearningExtractor.ts
import type { ExtractedLearning } from './learning-types.js';

export interface SessionInput {
  sessionId: string;
  project: string;
  observations: Array<{ title: string; narrative: string | null; facts: string[] }>;
  summary: { request: string; investigated: string; learned: string; next_steps: string } | null;
}

export interface LearningExtractorConfig {
  enabled: boolean;
  llm: (prompt: string) => Promise<string>;
  maxLearningsPerSession?: number;
}

const DEFAULT_MAX = 10;

function buildPrompt(input: SessionInput): string {
  const obsLines = input.observations
    .map(
      (o, i) =>
        `[${i + 1}] TITLE: ${o.title}\n    NARRATIVE: ${o.narrative ?? '(none)'}\n    FACTS: ${(o.facts ?? []).join(' | ')}`
    )
    .join('\n\n');

  const summaryBlock = input.summary
    ? `REQUEST: ${input.summary.request}\nINVESTIGATED: ${input.summary.investigated}\nLEARNED: ${input.summary.learned}\nNEXT STEPS: ${input.summary.next_steps}`
    : '(no summary)';

  return `You extract durable team learnings from a single coding session.
PROJECT: ${input.project}

SESSION OBSERVATIONS:
${obsLines || '(none)'}

SESSION SUMMARY:
${summaryBlock}

Extract 0 to N learnings useful to other agents/engineers on this codebase.
A learning is: a durable, generalizable, testable claim — NOT a play-by-play of what happened.
Skip transient details, commit noise, environment-specific paths.

For each learning, emit:
  claim:      concise statement (one sentence)
  evidence:   where/why this is known (short; cite file or fact)
  scope:      one of 'project', 'area', 'global' (or free-form short label)
  confidence: 0.0–1.0 — how confident you are this generalizes beyond this session

Respond with a JSON array. No prose, no code fences. Empty session -> [].
Example:
[{"claim":"Worker readiness depends on initialization completing","evidence":"worker-service.ts readiness path","scope":"area","confidence":0.9}]`;
}

function clamp(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function parseArray(text: string): ExtractedLearning[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map<ExtractedLearning>((item) => ({
        claim: String(item.claim ?? '').trim(),
        evidence: item.evidence == null ? null : String(item.evidence),
        scope: item.scope == null ? null : String(item.scope),
        confidence: clamp(Number(item.confidence ?? 0)),
      }))
      .filter((l) => l.claim.length > 0);
  } catch {
    return [];
  }
}

export class LearningExtractor {
  private readonly config: LearningExtractorConfig;
  private readonly max: number;

  constructor(config: LearningExtractorConfig) {
    this.config = config;
    this.max = config.maxLearningsPerSession ?? DEFAULT_MAX;
  }

  async extract(input: SessionInput): Promise<ExtractedLearning[]> {
    if (!this.config.enabled) return [];
    if (!input.observations.length && !input.summary) return [];
    const prompt = buildPrompt(input);
    try {
      const text = await this.config.llm(prompt);
      const parsed = parseArray(text);
      return parsed.slice(0, this.max);
    } catch {
      return [];
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/services/sync/__tests__/LearningExtractor.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/sync/LearningExtractor.ts src/services/sync/__tests__/LearningExtractor.test.ts
git commit -m "feat(sync): add LearningExtractor"
```

---

## Task 6: Server migration — `learnings` table

**Files:**
- Create: `supabase/migrations/20260416_learnings_table.sql`

No unit tests for raw SQL. Tests land at the API layer (Task 10+).

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/20260416_learnings_table.sql
CREATE TABLE IF NOT EXISTS learnings (
  id               bigserial PRIMARY KEY,
  claim            text NOT NULL,
  evidence         text,
  scope            text,
  confidence       real NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  project          text,
  source_agent_id  uuid REFERENCES agents(id),
  source_session   text,
  content_hash     text NOT NULL,
  invalidated      boolean NOT NULL DEFAULT false,
  invalidated_by   bigint REFERENCES learnings(id),
  extracted_at     timestamptz NOT NULL DEFAULT now(),
  reviewed_at      timestamptz,
  reviewed_by      text,
  edit_diff        jsonb,
  rejection_reason text,
  UNIQUE (source_session, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_learnings_status  ON learnings (status);
CREATE INDEX IF NOT EXISTS idx_learnings_project ON learnings (project);
CREATE INDEX IF NOT EXISTS idx_learnings_hash    ON learnings (content_hash);
CREATE INDEX IF NOT EXISTS idx_learnings_agent   ON learnings (source_agent_id);

-- schema_versions value: verify next free number before applying.
-- The initial migration inserts version 1. If other migrations have bumped past 2,
-- pick the next unused integer. INSERT uses ON CONFLICT DO NOTHING so it's safe to retry.
INSERT INTO schema_versions (version) VALUES (2) ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Apply migration locally**

Before applying, check the current max version:

```bash
rtk supabase db remote psql -c "SELECT MAX(version) FROM schema_versions"
```

Adjust the `VALUES (2)` literal if needed, then run:

```bash
rtk supabase db push
```

(Or the equivalent deploy command used in this repo — check `package.json` scripts.)

Expected: migration applied without error. Query `SELECT to_regclass('learnings');` returns `learnings`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260416_learnings_table.sql
git commit -m "feat(supabase): add learnings table (status + confidence + dedupe)"
```

---

## Task 7: Shared ConflictDetector prompt + server port

**Files:**
- Create: `api/lib/conflict-prompt.ts`
- Modify: `src/services/sync/ConflictDetector.ts` — import prompt from shared module (no behavior change)
- Create: `api/lib/ConflictDetector.ts`
- Test: `api/lib/__tests__/ConflictDetector.test.ts`

- [ ] **Step 1: Write the failing test for server port**

```ts
// api/lib/__tests__/ConflictDetector.test.ts
import { describe, expect, test } from 'bun:test';
import { ServerConflictDetector } from '../ConflictDetector.js';

function fakeSimilar(rows: Array<{ id: number; title: string }>) {
  return async () =>
    rows.map((r) => ({ id: r.id, title: r.title, narrative: null, agent_name: 'a', git_branch: null }));
}

describe('ServerConflictDetector', () => {
  test('disabled config -> ADD', async () => {
    const det = new ServerConflictDetector({ enabled: false, llm: async () => '{}', fetchSimilar: fakeSimilar([]) });
    const out = await det.check({ title: 'x', narrative: null });
    expect(out.decision).toBe('ADD');
  });

  test('no similar -> ADD', async () => {
    const det = new ServerConflictDetector({
      enabled: true,
      llm: async () => '{"decision":"UPDATE","targetId":1}',
      fetchSimilar: fakeSimilar([]),
    });
    const out = await det.check({ title: 'x', narrative: null });
    expect(out.decision).toBe('ADD');
  });

  test('LLM UPDATE with targetId preserved', async () => {
    const det = new ServerConflictDetector({
      enabled: true,
      llm: async () => '{"decision":"UPDATE","targetId":42,"reason":"supersedes"}',
      fetchSimilar: fakeSimilar([{ id: 42, title: 'old' }]),
    });
    const out = await det.check({ title: 'new', narrative: null });
    expect(out.decision).toBe('UPDATE');
    expect(out.targetId).toBe(42);
  });

  test('malformed JSON falls back to ADD', async () => {
    const det = new ServerConflictDetector({
      enabled: true,
      llm: async () => 'banana',
      fetchSimilar: fakeSimilar([{ id: 1, title: 'x' }]),
    });
    const out = await det.check({ title: 'x', narrative: null });
    expect(out.decision).toBe('ADD');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test api/lib/__tests__/ConflictDetector.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Factor shared prompt**

Create `api/lib/conflict-prompt.ts`:

```ts
// api/lib/conflict-prompt.ts
export interface SimilarItem {
  id: number;
  title: string | null;
  narrative: string | null;
  agent_name?: string | null;
  git_branch?: string | null;
}

export function buildConflictPrompt(
  item: { title: string; narrative?: string | null },
  similar: SimilarItem[]
): string {
  const similarText = similar
    .map(
      (s, i) =>
        `[${i + 1}] ID:${s.id} | Agent:${s.agent_name ?? 'unknown'} | Branch:${s.git_branch ?? 'unknown'}\n    TITLE: ${s.title ?? ''}\n    NARRATIVE: ${s.narrative ?? '(none)'}`
    )
    .join('\n\n');

  return `You are a memory conflict resolver for a shared AI coding assistant knowledge base.

A new item is about to be stored:
TITLE: ${item.title}
NARRATIVE: ${item.narrative ?? '(none)'}

Most semantically similar existing items:
${similarText}

Decide what to do. Choose ONE:
- ADD: New information, no conflict. Store it.
- UPDATE: Supersedes an existing one. Store new, invalidate old (provide targetId).
- INVALIDATE: Contradicts an existing one that appears wrong. Invalidate old, add new (provide targetId).
- NOOP: Duplicate or adds no value. Skip.

Respond ONLY with JSON: {"decision": "ADD"|"UPDATE"|"INVALIDATE"|"NOOP", "targetId": <number or null>, "reason": "<brief>"}`;
}
```

**Prompt location decision:** `api/lib/conflict-prompt.ts`. Rationale — the file has no Node/Bun-specific imports, and the client already imports across package boundaries via relative paths (e.g. `api/lib/SupabaseManager.ts` import used in `api/sync/push.ts`). The client-side `src/services/sync/ConflictDetector.ts` imports the prompt via relative path `../../../api/lib/conflict-prompt.js`. Do NOT duplicate the prompt text in both directories — remove the inline `buildPrompt` from the client detector.

- [ ] **Step 4: Implement server-side detector**

```ts
// api/lib/ConflictDetector.ts
import { buildConflictPrompt, type SimilarItem } from './conflict-prompt.js';

export type ConflictDecision = 'ADD' | 'UPDATE' | 'INVALIDATE' | 'NOOP';

export interface ServerConflictDetectorConfig {
  enabled: boolean;
  llm: (prompt: string) => Promise<string>;
  fetchSimilar: (item: { title: string; narrative?: string | null }) => Promise<SimilarItem[]>;
}

export interface ConflictCheckResult {
  decision: ConflictDecision;
  targetId?: number | null;
  reason?: string;
}

export class ServerConflictDetector {
  constructor(private cfg: ServerConflictDetectorConfig) {}

  async check(item: { title: string; narrative?: string | null }): Promise<ConflictCheckResult> {
    if (!this.cfg.enabled || !this.cfg.llm) return { decision: 'ADD' };
    try {
      const similar = await this.cfg.fetchSimilar(item);
      if (similar.length === 0) return { decision: 'ADD' };
      const prompt = buildConflictPrompt(item, similar);
      const text = await this.cfg.llm(prompt);
      const match = text.match(/\{[\s\S]*?\}/);
      if (!match) return { decision: 'ADD' };
      const parsed = JSON.parse(match[0]) as ConflictCheckResult;
      if (!['ADD', 'UPDATE', 'INVALIDATE', 'NOOP'].includes(parsed.decision)) {
        return { decision: 'ADD' };
      }
      return parsed;
    } catch {
      return { decision: 'ADD' };
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test api/lib/__tests__/ConflictDetector.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Run existing ConflictDetector tests**

Run: `bun test src/services/sync/__tests__/ConflictDetector.test.ts` (if present) and `bun test`.
Expected: no new failures.

- [ ] **Step 7: Commit**

```bash
git add api/lib/ConflictDetector.ts api/lib/conflict-prompt.ts api/lib/__tests__/ConflictDetector.test.ts src/services/sync/ConflictDetector.ts
git commit -m "feat(api): server-side ConflictDetector port + shared prompt module"
```

---

## Task 8: SupabaseManager — learning methods

**Files:**
- Modify: `api/lib/SupabaseManager.ts`
- Test: `api/lib/__tests__/SupabaseManager-learnings.test.ts`

**Approach note:** The existing `SupabaseManager` wraps the real client. For these tests, pass a mock Supabase client that records calls and returns canned rows (avoid hitting a real Supabase). Extract a minimal `SupabaseLike` interface if one isn't already exposed.

- [ ] **Step 1: Write the failing test**

```ts
// api/lib/__tests__/SupabaseManager-learnings.test.ts
import { describe, expect, test } from 'bun:test';
import { SupabaseManager } from '../SupabaseManager.js';

function mockClient() {
  const queryBuilder = {
    insert: (row: any) => ({ select: () => ({ single: async () => ({ data: { id: 101, ...row }, error: null }) }) }),
    upsert: (row: any, _opts: any) => ({ select: () => ({ single: async () => ({ data: { id: 101, ...row }, error: null }) }) }),
    select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: [{ id: 1, claim: 'x' }], error: null }) }) }) }),
    update: (patch: any) => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { id: 101, ...patch }, error: null }) }) }) }),
  };
  const from = (_table: string) => queryBuilder;
  return { from };
}

describe('SupabaseManager learnings methods', () => {
  test('insertLearning stores row with target status', async () => {
    const mgr = new SupabaseManager(mockClient() as any);
    const out = await mgr.insertLearning({
      claim: 'c', evidence: null, scope: null, confidence: 0.9,
      project: 'p', source_session: 's', content_hash: 'h', source_agent_id: 'agent-1',
    }, 'approved');
    expect(out.id).toBe(101);
  });

  test('listLearnings filters by status', async () => {
    const mgr = new SupabaseManager(mockClient() as any);
    const rows = await mgr.listLearnings({ status: 'pending', limit: 50, offset: 0 });
    expect(rows.length).toBe(1);
  });

  test('reviewLearning sets reviewed_at + reviewer', async () => {
    const mgr = new SupabaseManager(mockClient() as any);
    const out = await mgr.reviewLearning(42, {
      status: 'approved',
      reviewed_by: 'agent-key-xyz',
    });
    expect(out.status).toBe('approved');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test api/lib/__tests__/SupabaseManager-learnings.test.ts`
Expected: FAIL — methods missing.

- [ ] **Step 3: Add methods to SupabaseManager**

In `api/lib/SupabaseManager.ts`, add:

```ts
import type { LearningPayload, LearningTargetStatus, LearningRecord } from '../../src/services/sync/learning-types.js';

// Inside SupabaseManager class:

async insertLearning(
  payload: LearningPayload & { source_agent_id: string },
  targetStatus: LearningTargetStatus
): Promise<{ id: number; action: 'inserted' | 'dedupe_noop' }> {
  const row = {
    claim: payload.claim,
    evidence: payload.evidence,
    scope: payload.scope,
    confidence: payload.confidence,
    status: targetStatus,
    project: payload.project,
    source_agent_id: payload.source_agent_id,
    source_session: payload.source_session,
    content_hash: payload.content_hash,
  };
  const { data, error } = await this.client
    .from('learnings')
    .upsert(row, { onConflict: 'source_session,content_hash', ignoreDuplicates: true })
    .select()
    .single();

  if (error) throw error;
  if (!data) return { id: 0, action: 'dedupe_noop' };
  return { id: data.id, action: 'inserted' };
}

async invalidateLearning(id: number, replacedBy: number): Promise<void> {
  const { error } = await this.client
    .from('learnings')
    .update({ invalidated: true, invalidated_by: replacedBy })
    .eq('id', id);
  if (error) throw error;
}

async fetchSimilarLearnings(claim: string, limit = 5): Promise<Array<{
  id: number; title: string | null; narrative: string | null;
}>> {
  // POC: simple ILIKE on claim. Can be replaced with vector/FTS later.
  const { data, error } = await this.client
    .from('learnings')
    .select('id, claim, evidence')
    .eq('status', 'approved')
    .eq('invalidated', false)
    .ilike('claim', `%${claim.slice(0, 64)}%`)
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, title: r.claim, narrative: r.evidence ?? null }));
}

async listLearnings(opts: { status?: 'pending'|'approved'|'rejected'; project?: string; limit: number; offset: number }): Promise<LearningRecord[]> {
  let q = this.client.from('learnings').select('*');
  if (opts.status) q = q.eq('status', opts.status);
  if (opts.project) q = q.eq('project', opts.project);
  const { data, error } = await q.order('extracted_at', { ascending: false }).range(opts.offset, opts.offset + opts.limit - 1);
  if (error) throw error;
  return (data ?? []) as LearningRecord[];
}

async getLearning(id: number): Promise<LearningRecord | null> {
  const { data, error } = await this.client.from('learnings').select('*').eq('id', id).single();
  if (error && (error as any).code !== 'PGRST116') throw error;
  return (data as LearningRecord) ?? null;
}

async reviewLearning(id: number, patch: {
  status: 'approved' | 'rejected';
  reviewed_by: string;
  edit_diff?: Record<string, unknown> | null;
  edited?: Partial<Pick<LearningPayload, 'claim'|'evidence'|'scope'>>;
  rejection_reason?: string;
}): Promise<LearningRecord> {
  const update: Record<string, unknown> = {
    status: patch.status,
    reviewed_at: new Date().toISOString(),
    reviewed_by: patch.reviewed_by,
  };
  if (patch.edit_diff !== undefined) update.edit_diff = patch.edit_diff;
  if (patch.edited) Object.assign(update, patch.edited);
  if (patch.rejection_reason !== undefined) update.rejection_reason = patch.rejection_reason;

  const { data, error } = await this.client
    .from('learnings')
    .update(update)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as LearningRecord;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test api/lib/__tests__/SupabaseManager-learnings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add api/lib/SupabaseManager.ts api/lib/__tests__/SupabaseManager-learnings.test.ts
git commit -m "feat(api): SupabaseManager learning CRUD + dedupe helpers"
```

---

## Task 9: `POST /api/sync/learnings` endpoint

**Files:**
- Create: `api/sync/learnings.ts`
- Create: `api/lib/llm.ts`
- Test: `api/sync/__tests__/learnings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// api/sync/__tests__/learnings.test.ts
// Mirror the mocking pattern from existing api/__tests__/*.test.ts
// (inspect api/__tests__/push.test.ts or equivalent for conventions, then adapt).

// Cases to cover:
// - 405 on non-POST
// - 401 when authenticateRequest returns null
// - 400 on malformed body (missing target_status or learnings array)
// - approved path triggers server-side ConflictDetector
// - pending path skips ConflictDetector and inserts with status='pending'
// - dedupe_noop returned when unique constraint hits
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test api/sync/__tests__/learnings.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement endpoint**

```ts
// api/sync/learnings.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initSupabase } from '../lib/SupabaseManager.js';
import { authenticateRequest } from '../auth.js';
import { ServerConflictDetector } from '../lib/ConflictDetector.js';
import { getLlmClosure } from '../lib/llm.js';
import type { LearningPushRequest, LearningPushResponse, LearningPushResult } from '../../src/services/sync/learning-types.js';

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const auth = await authenticateRequest(req);
  if (!auth) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const body = req.body as LearningPushRequest;
  if (!body || !Array.isArray(body.learnings) || !['approved', 'pending'].includes(body.target_status)) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_ANON_KEY!;
  const db = await initSupabase(supabaseUrl, supabaseKey);

  const detector = new ServerConflictDetector({
    enabled: body.target_status === 'approved',
    llm: getLlmClosure(),
    fetchSimilar: (item) => db.fetchSimilarLearnings(item.title, 5),
  });

  const results: LearningPushResult[] = [];

  for (const learning of body.learnings) {
    try {
      let targetId: number | null = null;
      let action: LearningPushResult['action'] = 'inserted';

      if (body.target_status === 'approved') {
        const decision = await detector.check({ title: learning.claim, narrative: learning.evidence });
        if (decision.decision === 'NOOP') {
          results.push({ content_hash: learning.content_hash, action: 'dedupe_noop' });
          continue;
        }
        if ((decision.decision === 'UPDATE' || decision.decision === 'INVALIDATE') && decision.targetId) {
          targetId = decision.targetId;
          action = decision.decision === 'UPDATE' ? 'updated_target' : 'invalidated_target';
        }
      }

      const ins = await db.insertLearning(
        { ...learning, source_agent_id: auth.agentId },
        body.target_status
      );

      if (targetId && ins.id) {
        await db.invalidateLearning(targetId, ins.id);
      }

      if (ins.action === 'dedupe_noop') {
        results.push({ content_hash: learning.content_hash, action: 'dedupe_noop' });
      } else {
        results.push({ content_hash: learning.content_hash, id: ins.id, action });
      }
    } catch (err: any) {
      results.push({ content_hash: learning.content_hash, action: 'inserted', error: err?.message ?? 'unknown' });
    }
  }

  const response: LearningPushResponse = { results };
  res.status(200).json(response);
}
```

And `api/lib/llm.ts`:

```ts
// api/lib/llm.ts
// Minimal LLM closure for server-side operations.
// Uses ANTHROPIC_API_KEY + CLAUDE_MEM_LEARNING_LLM_MODEL env var.
export function getLlmClosure(): (prompt: string) => Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.CLAUDE_MEM_LEARNING_LLM_MODEL ?? 'claude-sonnet-4-6';
  if (!apiKey) {
    return async () => { throw new Error('ANTHROPIC_API_KEY missing'); };
  }
  return async (prompt: string): Promise<string> => {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!resp.ok) throw new Error(`Anthropic API ${resp.status}`);
    const json = await resp.json() as any;
    const text = json?.content?.[0]?.text ?? '';
    return String(text);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test api/sync/__tests__/learnings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/sync/learnings.ts api/lib/llm.ts api/sync/__tests__/learnings.test.ts
git commit -m "feat(api): POST /api/sync/learnings with detector on approved path"
```

---

## Task 10: Dashboard API — list / detail / review

**Files:**
- Create: `api/learnings/index.ts` — `GET /api/learnings`
- Create: `api/learnings/[id].ts` — `GET /api/learnings/:id`
- Create: `api/learnings/[id]/review.ts` — `POST /api/learnings/:id/review`
- Test: `api/learnings/__tests__/dashboard-api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// api/learnings/__tests__/dashboard-api.test.ts
// Mirror the mocking pattern from existing api tests.
// Cases:
// - list 401 unauthenticated
// - list filters by status query param
// - detail 404 for unknown id
// - review approve calls detector, returns status=approved
// - review reject sets status=rejected + rejection_reason
// - review edit_approve records edit_diff and uses edited values as detector input
// - review returns rejected when detector decides NOOP
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test api/learnings/__tests__/dashboard-api.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `api/learnings/index.ts`**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initSupabase } from '../lib/SupabaseManager.js';
import { authenticateRequest } from '../auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const auth = await authenticateRequest(req);
  if (!auth) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const status = (req.query.status as string | undefined) as any;
  const project = req.query.project as string | undefined;
  const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10) || 50, 200);
  const offset = parseInt((req.query.offset as string) ?? '0', 10) || 0;

  const db = await initSupabase(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  const rows = await db.listLearnings({ status, project, limit, offset });
  res.status(200).json({ learnings: rows });
}
```

- [ ] **Step 4: Implement `api/learnings/[id].ts`**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initSupabase } from '../lib/SupabaseManager.js';
import { authenticateRequest } from '../auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await authenticateRequest(req);
  if (!auth) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const id = parseInt(req.query.id as string, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }

  const db = await initSupabase(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  const row = await db.getLearning(id);
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.status(200).json({ learning: row });
}
```

- [ ] **Step 5: Implement `api/learnings/[id]/review.ts`**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initSupabase } from '../../lib/SupabaseManager.js';
import { authenticateRequest } from '../../auth.js';
import { ServerConflictDetector } from '../../lib/ConflictDetector.js';
import { getLlmClosure } from '../../lib/llm.js';
import type { LearningReviewAction, LearningRecord } from '../../../src/services/sync/learning-types.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const auth = await authenticateRequest(req);
  if (!auth) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const id = parseInt(req.query.id as string, 10);
  if (!id) { res.status(400).json({ error: 'id required' }); return; }

  const body = req.body as LearningReviewAction;
  const db = await initSupabase(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  const existing = await db.getLearning(id);
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

  if (body.action === 'reject') {
    const updated = await db.reviewLearning(id, {
      status: 'rejected',
      reviewed_by: auth.agentId,
      rejection_reason: body.rejection_reason ?? null as any,
    });
    res.status(200).json({ learning: updated });
    return;
  }

  // approve / edit_approve
  let effective: LearningRecord = existing;
  let editDiff: Record<string, unknown> | null = null;
  if (body.action === 'edit_approve') {
    editDiff = {
      before: { claim: existing.claim, evidence: existing.evidence, scope: existing.scope },
      after: body.edited,
    };
    effective = { ...existing, ...body.edited } as LearningRecord;
  }

  const detector = new ServerConflictDetector({
    enabled: true,
    llm: getLlmClosure(),
    fetchSimilar: (item) => db.fetchSimilarLearnings(item.title, 5),
  });
  const decision = await detector.check({ title: effective.claim, narrative: effective.evidence ?? null });

  if (decision.decision === 'NOOP') {
    const updated = await db.reviewLearning(id, {
      status: 'rejected',
      reviewed_by: auth.agentId,
      rejection_reason: 'dedupe_noop: detector judged duplicate',
      edit_diff: editDiff,
    });
    res.status(200).json({ learning: updated, decision });
    return;
  }

  const updated = await db.reviewLearning(id, {
    status: 'approved',
    reviewed_by: auth.agentId,
    edit_diff: editDiff,
    edited: body.action === 'edit_approve' ? body.edited : undefined,
  });

  if ((decision.decision === 'UPDATE' || decision.decision === 'INVALIDATE') && decision.targetId) {
    await db.invalidateLearning(decision.targetId, updated.id);
  }

  res.status(200).json({ learning: updated, decision });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test api/learnings/__tests__/dashboard-api.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add api/learnings/ api/learnings/__tests__/
git commit -m "feat(api): dashboard endpoints — list, detail, review"
```

---

## Task 11: SyncClient — `pushLearnings`

**Files:**
- Modify: `src/services/sync/SyncClient.ts`
- Test: `src/services/sync/__tests__/SyncClient-learnings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/sync/__tests__/SyncClient-learnings.test.ts
import { describe, expect, test, mock } from 'bun:test';
import { SyncClient } from '../SyncClient.js';

const clientConfig = { serverUrl: 'https://e.test', apiKey: 'k', agentName: 'test-agent', timeoutMs: 5000 };

describe('SyncClient.pushLearnings', () => {
  test('POSTs to /api/sync/learnings with target_status', async () => {
    const captured: any = {};
    globalThis.fetch = mock(async (url: any, init: any) => {
      captured.url = String(url);
      captured.body = JSON.parse(init.body);
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as any;

    const c = new SyncClient(clientConfig);
    await c.pushLearnings([{
      claim: 'x', evidence: null, scope: null, confidence: 0.9,
      project: 'p', source_session: 's', content_hash: 'h',
    }], 'approved');

    expect(captured.url).toBe('https://e.test/api/sync/learnings');
    expect(captured.body.target_status).toBe('approved');
    expect(captured.body.learnings.length).toBe(1);
  });

  test('throws with HTTP status on non-2xx', async () => {
    globalThis.fetch = mock(async () => new Response('boom', { status: 500 })) as any;
    const c = new SyncClient(clientConfig);
    await expect(c.pushLearnings([], 'pending')).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/sync/__tests__/SyncClient-learnings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add method**

In `src/services/sync/SyncClient.ts`:

```ts
import type { LearningPayload, LearningTargetStatus, LearningPushResponse } from './learning-types.js';

// Inside SyncClient class:

async pushLearnings(learnings: LearningPayload[], target_status: LearningTargetStatus): Promise<LearningPushResponse> {
  const response = await fetch(this.buildUrl('/api/sync/learnings'), {
    method: 'POST',
    headers: { ...this.buildHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ learnings, target_status }),
  });
  if (!response.ok) {
    throw new Error(`pushLearnings failed (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<LearningPushResponse>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/services/sync/__tests__/SyncClient-learnings.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/sync/SyncClient.ts src/services/sync/__tests__/SyncClient-learnings.test.ts
git commit -m "feat(sync): SyncClient.pushLearnings"
```

---

## Task 12: SyncWorker — extraction flow + threshold split + legacy flag

**Files:**
- Modify: `src/services/sync/SyncWorker.ts`
- Modify: `src/services/sqlite/SessionStore.ts` (add extraction state helpers)
- Test: `src/services/sync/__tests__/SyncWorker-extraction.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/sync/__tests__/SyncWorker-extraction.test.ts
import { describe, expect, test } from 'bun:test';
import { SyncWorker } from '../SyncWorker.js';

// Build in-memory SessionStore + SyncQueue + fakes for LearningExtractor + SyncClient.
// Create a session with one observation + summary, extraction_status='pending'.

describe('SyncWorker extraction split', () => {
  test('high-conf learning queued with target_status=approved', async () => {
    // Arrange: extractor returns [{claim, confidence: 0.95}], threshold 0.8
    // Act: worker.extractSessionLearnings(sessionId)
    // Assert: queue contains 1 learning with target_status='approved'
  });
  test('low-conf learning queued with target_status=pending', async () => {
    // Arrange: extractor returns [{claim, confidence: 0.5}], threshold 0.8
    // Assert: queue contains 1 learning with target_status='pending'
  });
  test('extractor throws -> extraction_status becomes failed, attempts incremented', async () => {});
  test('max_retries exceeded -> status becomes permanently_failed', async () => {});
  test('tick processes learning queue items via SyncClient.pushLearnings', async () => {});
  test('feature flag disabled falls back to legacy observation push', async () => {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/sync/__tests__/SyncWorker-extraction.test.ts`
Expected: FAIL — methods missing.

- [ ] **Step 3: Add SessionStore helpers**

```ts
// SessionStore.ts — extraction state helpers
markExtractionInProgress(id: number): void {
  this.db.run("UPDATE sdk_sessions SET extraction_status = 'in_progress' WHERE id = ?", [id]);
}
markExtractionDone(id: number): void {
  this.db.run("UPDATE sdk_sessions SET extraction_status = 'done' WHERE id = ?", [id]);
}
markExtractionPending(id: number): void {
  this.db.run("UPDATE sdk_sessions SET extraction_status = 'pending' WHERE id = ?", [id]);
}
markExtractionFailed(id: number, maxRetries: number): void {
  const row = this.db.query<{ attempts: number }, [number]>(
    'SELECT extraction_attempts + 1 as attempts FROM sdk_sessions WHERE id = ?'
  ).get(id);
  const attempts = row?.attempts ?? 1;
  const nextStatus = attempts >= maxRetries ? 'permanently_failed' : 'failed';
  this.db.run(
    'UPDATE sdk_sessions SET extraction_status = ?, extraction_attempts = ? WHERE id = ?',
    [nextStatus, attempts, id]
  );
}
getPendingExtractionSessions(limit: number): Array<{ id: number; project: string; memory_session_id: string | null }> {
  return this.db.query<{ id: number; project: string; memory_session_id: string | null }, [number]>(
    `SELECT id, project, memory_session_id FROM sdk_sessions
     WHERE extraction_status IN ('pending','failed')
       AND completed_at IS NOT NULL
     ORDER BY id ASC LIMIT ?`
  ).all(limit);
}
```

- [ ] **Step 4: Modify SyncWorker**

Add fields to `SyncWorkerConfig`:

```ts
import { LearningExtractor, type SessionInput } from './LearningExtractor.js';
import type { LearningPayload, LearningTargetStatus } from './learning-types.js';

export interface SyncWorkerConfig {
  // ...existing...
  extractor?: LearningExtractor;
  confidenceThreshold?: number;
  extractionEnabled?: boolean;
  extractionMaxRetries?: number;
}
```

Add methods (inside the `SyncWorker` class):

```ts
async extractSessionLearnings(sessionDbId: number): Promise<void> {
  if (!this.extractionEnabled || !this.extractor) return;
  const session = this.sessionStore.getSessionById(sessionDbId);
  if (!session) return;
  this.sessionStore.markExtractionInProgress(sessionDbId);
  try {
    const input = this.buildSessionInput(session);
    const learnings = await this.extractor.extract(input);
    const threshold = this.confidenceThreshold ?? 0.8;
    for (const l of learnings) {
      const payload: LearningPayload = {
        ...l,
        project: session.project,
        source_session: session.memory_session_id ?? String(session.id),
        content_hash: sha256(`${l.claim}\n${l.scope ?? ''}`),
      };
      const target: LearningTargetStatus = l.confidence >= threshold ? 'approved' : 'pending';
      this.queue.enqueueLearning(payload, target);
    }
    this.sessionStore.markExtractionDone(sessionDbId);
  } catch (err) {
    this.sessionStore.markExtractionFailed(sessionDbId, this.extractionMaxRetries ?? 3);
  }
}

private buildSessionInput(session: { id: number; project: string; memory_session_id: string | null }): SessionInput {
  const obsRows = this.sessionStore.getObservationsForSession(session.memory_session_id ?? '');
  const summaryRow = session.memory_session_id
    ? this.sessionStore.getSummaryForSession(session.memory_session_id)
    : null;
  return {
    sessionId: String(session.id),
    project: session.project,
    observations: obsRows.map((o: any) => ({
      title: o.title ?? '',
      narrative: o.narrative ?? null,
      facts: this.parseJsonArray(o.facts),
    })),
    summary: summaryRow
      ? {
          request: summaryRow.request ?? '',
          investigated: summaryRow.investigated ?? '',
          learned: summaryRow.learned ?? '',
          next_steps: summaryRow.next_steps ?? '',
        }
      : null,
  };
}
```

Modify `tick()`:

```ts
async tick(): Promise<void> {
  if (!this.enabled || this.paused) return;

  // 1. Extract pending/retryable sessions
  if (this.extractionEnabled && this.extractor) {
    const sessions = this.sessionStore.getPendingExtractionSessions(5);
    for (const s of sessions) {
      await this.extractSessionLearnings(s.id);
    }
  }

  // 2. Drain the sync queue
  const pending = this.queue.getPending(this.batchSize);
  if (pending.length === 0) return;

  const learningItems = pending.filter((p) => p.entity_type === 'learning');
  const legacyItems = pending.filter((p) => p.entity_type !== 'learning');

  const approvedItems = learningItems.filter((p) => p.target_status === 'approved');
  const pendingItems  = learningItems.filter((p) => p.target_status === 'pending');

  for (const [group, status] of [
    [approvedItems, 'approved'],
    [pendingItems, 'pending'],
  ] as const) {
    if (group.length === 0) continue;
    try {
      await this.client.pushLearnings(group.map((g) => g.payload!), status);
      this.queue.markSynced(group.map((g) => g.id));
    } catch (err: any) {
      this.handlePushError(err, group.map((g) => g.id));
    }
  }

  // Legacy observation/session/summary path (kept behind flag for rollback)
  if (!this.extractionEnabled && legacyItems.length > 0) {
    const payload = this.buildPayload(legacyItems);
    const ids = legacyItems.map((i) => i.id);
    try {
      await this.client.push(payload);
      this.queue.markSynced(ids);
    } catch (err: any) {
      this.handlePushError(err, ids);
    }
  } else if (legacyItems.length > 0) {
    // Feature flag on, but legacy items snuck in: drop them
    this.queue.markSynced(legacyItems.map((i) => i.id));
  }
}

private handlePushError(error: any, ids: number[]): void {
  const statusMatch = error.message?.match(/\((\d{3})\)/);
  const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;
  if (statusCode >= 400 && statusCode < 500) {
    this.queue.markFailedPermanently(ids);
  } else {
    this.queue.markFailed(ids);
  }
}
```

Top-level hash helper (Bun-native):

```ts
function sha256(s: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(s);
  return hasher.digest('hex');
}
```

- [ ] **Step 5: Run tests**

Run: `bun test src/services/sync/__tests__/SyncWorker-extraction.test.ts`
Expected: PASS (6 tests).

Run: `bun test`
Expected: no new failures.

- [ ] **Step 6: Commit**

```bash
git add src/services/sync/SyncWorker.ts src/services/sqlite/SessionStore.ts src/services/sync/__tests__/SyncWorker-extraction.test.ts
git commit -m "feat(sync): SyncWorker extracts per-session learnings + threshold split"
```

---

## Task 13: SessionEnd hook — mark extraction pending

**Files:**
- Modify: `src/hooks/session-end.ts` (or equivalent — find under `src/hooks/`)
- Test: extend whichever test file currently covers session-end.

- [ ] **Step 1: Locate hook**

Run: `rtk grep -rn "session-end\|SessionEnd" src/hooks/` and note the source path.

- [ ] **Step 2: Write the failing test**

Add a test asserting that when the hook closes a session, `extraction_status` is `'pending'` afterwards (hook should set it explicitly, not rely on default):

```ts
// assertion sketch; adapt to existing hook test framework
expect(store.getSessionById(sessionId)?.extraction_status).toBe('pending');
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test <hook-test-path>`
Expected: FAIL.

- [ ] **Step 4: Update hook**

Inside the session-close code path, after `markSessionCompleted(sessionId)`:

```ts
store.markExtractionPending(sessionId);
```

(helper added in Task 12).

- [ ] **Step 5: Run test**

Run: `bun test <hook-test-path>`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/<file> <test-file>
git commit -m "feat(hooks): session-end marks extraction_status=pending"
```

---

## Task 14: Wire LearningExtractor + threshold into worker-service

**Files:**
- Modify: `src/services/worker-service.ts`
- Test: smoke test — new or existing `worker-service` integration test.

- [ ] **Step 1: Locate construction sites**

Run: `rtk grep -n "new SyncWorker\|new ConflictDetector" src/services/worker-service.ts`.
Expected: existing construction sites. Extend them.

- [ ] **Step 2: Build the `llm` closure from settings**

In worker-service startup, after settings are loaded (find the existing Claude Agent SDK entry via `rtk grep -n "claude-agent-sdk\|ClaudeAgentSDK" src/`):

```ts
import { LearningExtractor } from './sync/LearningExtractor.js';

const llm = buildLlmClosure({
  model: settings.CLAUDE_MEM_LEARNING_LLM_MODEL,
  // reuse existing Claude Agent SDK path used for summaries
});

const extractor = new LearningExtractor({
  enabled: settings.CLAUDE_MEM_LEARNING_EXTRACTION_ENABLED,
  llm,
  maxLearningsPerSession: settings.CLAUDE_MEM_LEARNING_MAX_PER_SESSION,
});

const syncWorker = new SyncWorker({
  // ...existing fields...
  extractor,
  confidenceThreshold: settings.CLAUDE_MEM_LEARNING_CONFIDENCE_THRESHOLD,
  extractionEnabled: settings.CLAUDE_MEM_LEARNING_EXTRACTION_ENABLED,
  extractionMaxRetries: settings.CLAUDE_MEM_LEARNING_EXTRACTION_MAX_RETRIES,
});
```

- [ ] **Step 3: Run smoke test / full suite**

Run: `bun test`
Expected: no new failures. If there's a worker-service integration test, exercise it.

- [ ] **Step 4: Commit**

```bash
git add src/services/worker-service.ts
git commit -m "feat(worker): wire LearningExtractor + threshold + feature flag"
```

---

## Task 15: Dashboard — minimal list/detail/review UI (DOM-only, no innerHTML)

**Files:**
- Create: `public/dashboard/index.html`
- Create: `public/dashboard/app.js`
- Create: `public/dashboard/styles.css`

No TDD — static assets + small amount of DOM-safe JS. **All DOM construction uses `createElement` + `textContent`. No `innerHTML` with any server-provided data.** Total ≤200 LOC.

- [ ] **Step 1: `index.html`**

```html
<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <title>Engram — Pending Learnings</title>
  <link rel="stylesheet" href="./styles.css">
</head><body>
  <header>
    <h1>Pending Learnings</h1>
    <div id="filters">
      <select id="statusFilter">
        <option value="pending">Pending</option>
        <option value="approved">Approved</option>
        <option value="rejected">Rejected</option>
      </select>
      <input id="projectFilter" placeholder="Project (optional)">
      <button id="refresh">Refresh</button>
      <button id="logout">Reset key</button>
    </div>
  </header>
  <main id="list"></main>
  <script src="./app.js"></script>
</body></html>
```

- [ ] **Step 2: `app.js` (DOM-safe)**

```js
// web/dashboard/app.js
// IMPORTANT: never use innerHTML with server data. Always createElement + textContent.

const API = location.origin;
const KEY = 'engram_dashboard_token';

async function authedFetch(path, opts = {}) {
  const token = localStorage.getItem(KEY);
  if (!token) { requestToken(); throw new Error('no token'); }
  const headers = { ...(opts.headers ?? {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const r = await fetch(`${API}${path}`, { ...opts, headers });
  if (r.status === 401) { localStorage.removeItem(KEY); requestToken(); throw new Error('unauthorized'); }
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

function requestToken() {
  const t = prompt('Enter engram agent key:');
  if (t) localStorage.setItem(KEY, t.trim());
}

function el(tag, opts = {}) {
  const n = document.createElement(tag);
  if (opts.className) n.className = opts.className;
  if (opts.text != null) n.textContent = String(opts.text);
  if (opts.onClick) n.addEventListener('click', opts.onClick);
  return n;
}

function renderEmpty(list) {
  list.textContent = '';
  const p = el('p', { text: 'No items.' });
  list.appendChild(p);
}

function renderCard(list, l) {
  const card = el('article', { className: 'card' });
  card.dataset.id = l.id;

  const meta = el('div', { className: 'meta' });
  const conf = el('span', { className: 'conf', text: `${(l.confidence * 100).toFixed(0)}%` });
  const proj = el('span', { className: 'proj', text: l.project ?? '' });
  meta.append(conf, proj);

  const h2 = el('h2', { text: l.claim });
  const ev = el('p', { className: 'evidence', text: l.evidence ?? '' });

  const actions = el('div', { className: 'actions' });
  const approve = el('button', { text: 'Approve', onClick: () => doReview(l.id, { action: 'approve' }) });
  const edit = el('button', { text: 'Edit & Approve', onClick: () => doEdit(l) });
  const reject = el('button', { text: 'Reject', onClick: () => doReject(l.id) });
  actions.append(approve, edit, reject);

  card.append(meta, h2, ev, actions);
  list.appendChild(card);
}

async function doReview(id, body) {
  await authedFetch(`/api/learnings/${id}/review`, { method: 'POST', body: JSON.stringify(body) });
  renderList();
}

async function doReject(id) {
  const reason = prompt('Rejection reason?') ?? '';
  await doReview(id, { action: 'reject', rejection_reason: reason });
}

async function doEdit(l) {
  const claim = prompt('Edit claim:', l.claim);
  if (claim == null) return;
  const evidence = prompt('Edit evidence:', l.evidence ?? '');
  const scope = prompt('Scope:', l.scope ?? '') || null;
  await doReview(l.id, { action: 'edit_approve', edited: { claim, evidence, scope } });
}

async function renderList() {
  const status = document.getElementById('statusFilter').value;
  const project = document.getElementById('projectFilter').value.trim();
  const params = new URLSearchParams({ status, ...(project ? { project } : {}) });
  const { learnings } = await authedFetch(`/api/learnings?${params}`);
  const list = document.getElementById('list');
  list.textContent = '';
  if (!learnings.length) { renderEmpty(list); return; }
  for (const l of learnings) renderCard(list, l);
}

document.getElementById('refresh').addEventListener('click', renderList);
document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem(KEY);
  location.reload();
});
document.getElementById('statusFilter').addEventListener('change', renderList);
document.getElementById('projectFilter').addEventListener('change', renderList);
renderList();
```

- [ ] **Step 3: `styles.css` (minimal)**

```css
body { font: 14px/1.5 system-ui, sans-serif; margin: 0; background: #fafaf9; color: #222; }
header { padding: 1rem 2rem; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
main { padding: 1rem 2rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 1rem; }
.card { background: #fff; border: 1px solid #e5e5e5; border-radius: 6px; padding: 1rem; }
.card .meta { display: flex; gap: .5rem; font-size: 12px; color: #888; margin-bottom: .5rem; }
.card .conf { background: #111; color: #fff; padding: 2px 6px; border-radius: 3px; }
.actions { display: flex; gap: .5rem; margin-top: .75rem; }
button { padding: .4rem .8rem; border: 1px solid #ccc; background: #fff; cursor: pointer; border-radius: 4px; }
button:hover { background: #f0f0f0; }
```

- [ ] **Step 4: Vercel route — serve `/dashboard/*` from `public/dashboard/`**

Current state: `vercel.json` has no rewrites and the repo has **no `public/` dir**. Add static hosting via `public/` (Vercel's zero-config static root):

1. Create `public/dashboard/` and move the three files (`index.html`, `app.js`, `styles.css`) there — OR keep the source files in `web/dashboard/` and add a build step that copies them.
2. Simplest: **put the files directly in `public/dashboard/`** for the POC. No rewrite needed; Vercel serves `public/**` at the root.
3. Add `.gitignore` entries if the build step creates derived files; otherwise just check in the three files.

Verify:
```bash
rtk vercel dev
# open http://localhost:3000/dashboard/
```
If a 404 occurs, check `vercel.json` `outputDirectory` (currently `.`) — you may need to set it to `public` or add `{ "source": "/dashboard", "destination": "/dashboard/index.html" }` to `rewrites`.

- [ ] **Step 5: Smoke test manually**

- Deploy preview: `rtk vercel`.
- Open `<preview>/dashboard/`.
- Paste an agent key; confirm list renders.
- Approve/reject/edit a row; confirm status transitions via `GET /api/learnings/:id`.

- [ ] **Step 6: Commit**

```bash
git add public/dashboard/ vercel.json
git commit -m "feat(dashboard): minimal pending-learning review UI (DOM-safe)"
```

---

## Task 16: Team search — filter to approved non-invalidated learnings

**Files:**
- Modify: `api/search.ts` (and `api/timeline.ts` if it surfaces learnings)
- Modify: `api/lib/SupabaseManager.ts`
- Test: `api/__tests__/search-learnings.test.ts`

**Note:** If `/api/search` currently returns observations from the `observations` table, add learnings as an additional source. Do not delete the observations path yet — the rollback flag depends on it.

- [ ] **Step 1: Write the failing test**

```ts
// api/__tests__/search-learnings.test.ts
// Mock SupabaseManager.searchLearnings to return a mix of approved/pending/rejected/invalidated rows.
// Assert /api/search response only includes approved AND invalidated=false rows.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test api/__tests__/search-learnings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend SupabaseManager**

```ts
async searchLearnings(query: string, project?: string, limit = 10): Promise<LearningRecord[]> {
  let q = this.client
    .from('learnings')
    .select('*')
    .eq('status', 'approved')
    .eq('invalidated', false)
    .ilike('claim', `%${query.slice(0, 64)}%`)
    .limit(limit);
  if (project) q = q.eq('project', project);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as LearningRecord[];
}
```

Plumb results into `/api/search`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test api/__tests__/search-learnings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/search.ts api/lib/SupabaseManager.ts api/__tests__/search-learnings.test.ts
git commit -m "feat(search): include approved non-invalidated learnings"
```

---

## Task 17: Documentation — user-facing feature page

**Files:**
- Create: `docs/public/features/learning-extraction.mdx`
- Modify: `docs/public/docs.json` (add nav entry)

- [ ] **Step 1: Write the doc page**

```mdx
---
title: "Learning Extraction"
description: "How engram distills session activity into durable team learnings."
---

# Learning Extraction

Engram runs an LLM-backed extractor at the end of every session...
(150–250 words covering: what it is, flow, confidence threshold, where review happens, how to disable)
```

- [ ] **Step 2: Add nav entry**

Edit `docs/public/docs.json` to include the new page under the features section.

- [ ] **Step 3: Commit**

```bash
git add docs/public/features/learning-extraction.mdx docs/public/docs.json
git commit -m "docs: add learning extraction feature page"
```

---

## Task 18: End-to-end verification (manual)

No automated test — produces a checklist you execute and report results back to the user.

- [ ] **Step 1: Run local stack**

```bash
bun run build-and-sync
bun run dev
```

- [ ] **Step 2: Generate traffic**

Run a real Claude Code session in the repo. Finish it normally so `SessionEnd` fires.

- [ ] **Step 3: Verify extraction**

```bash
sqlite3 ~/.claude-mem/claude-mem.db \
  "SELECT id, project, extraction_status, extraction_attempts FROM sdk_sessions ORDER BY id DESC LIMIT 5"
```
Expected: newest row has `extraction_status='done'`.

- [ ] **Step 4: Verify server state**

```bash
curl -s -H "Authorization: Bearer $(rtk cat ~/.claude-mem/agent-key)" \
  "https://engram-ashy.vercel.app/api/learnings?status=pending&limit=5"
```
Expected: JSON with any low-confidence learnings from that session.

- [ ] **Step 5: Dashboard smoke test**

Open `https://engram-ashy.vercel.app/dashboard/`, paste the key, approve one item. Re-curl and confirm `status=approved`.

- [ ] **Step 6: Team search returns new learning**

```bash
curl -s -H "Authorization: Bearer $KEY" "https://engram-ashy.vercel.app/api/search?q=<fragment-of-the-claim>"
```
Expected: approved learning appears in results.

- [ ] **Step 7: Rollback smoke test**

Flip `CLAUDE_MEM_LEARNING_EXTRACTION_ENABLED` to `false` in `~/.claude-mem/settings.json`, restart worker, run another session. Confirm legacy observation rows still push to `/api/sync/push` and **no** new learnings are extracted.

- [ ] **Step 8: Report results to user, restore flag to `true`**

---

## Global closeout

- [ ] **Step 1: Full suite green**

Run: `bun test`
Expected: all pass.

- [ ] **Step 2: Lint / typecheck (if repo has commands)**

Run: `bun run typecheck` (or whichever script exists).
Expected: zero errors.

- [ ] **Step 3: Final commit / PR**

Open a PR summarizing the feature, linking to the spec. Let the user review and merge.
