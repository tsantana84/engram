# Sync Pipeline Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing SyncQueue/SyncClient/SyncWorker into the running worker service so local observations and summaries are pushed to Supabase, and team search pulls results from other agents.

**Architecture:** `SessionStore` gains a `syncQueue` property; after each successful insert it enqueues the new entity ID. `worker-service.ts` reads sync settings on startup, creates `SyncQueue`/`SyncClient`/`SyncWorker`, injects them into `SessionStore` and `SearchManager`, and starts the push interval. `SyncWorker` ticks every 30s, batches pending queue items, and POSTs to `https://engram-ashy.vercel.app/api/sync/push`. Team search is already wired in `SearchManager` — it just needs a `SyncClient` instance.

**Tech Stack:** Bun, TypeScript, bun:sqlite, Express (worker HTTP), Supabase (cloud backend via Vercel)

---

## Files

| File | Change |
|------|--------|
| `src/services/sqlite/migrations/runner.ts` | Update `createSyncQueueTable()` from version 26 → 27 to avoid version collision with `SessionStore.addObservationModelColumns()` |
| `src/services/sqlite/SessionStore.ts` | Add `sync_queue` migration (v27), `syncQueue` property, `setSyncQueue()`, enqueue in `storeObservation` + `storeSummary` |
| `src/services/worker-service.ts` | Instantiate `SyncQueue`/`SyncClient`/`SyncWorker` in `initialize()`, wire to `SessionStore` + `SearchManager`, stop in `shutdown()` |
| `tests/services/sqlite/SessionStore.sync.test.ts` | New: verify enqueue is called after store operations |

---

## Task 1: Fix version collision in `MigrationRunner`

**Context:** `MigrationRunner` (`src/services/sqlite/migrations/runner.ts`) uses version 26 for `createSyncQueueTable()`. But `SessionStore.addObservationModelColumns()` also claims version 26. Since both write to the same `schema_versions` table, whichever runs first on a production DB will mark 26 as applied and the other will be silently skipped. Fix: bump `MigrationRunner.createSyncQueueTable()` to version 27.

**Files:**
- Modify: `src/services/sqlite/migrations/runner.ts` (lines ~989, ~1009)

- [ ] **Step 1: Update version numbers in `MigrationRunner.createSyncQueueTable()`**

In `runner.ts`, find the `createSyncQueueTable` method. Change both occurrences of `26` to `27`:

```typescript
// line ~989 — version guard
const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(27) as SchemaVersion | undefined;

// line ~1009 — version record insert
this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(27, new Date().toISOString());
```

- [ ] **Step 2: Run the SyncQueue and SyncWorker tests to verify nothing broke**

```bash
cd /Users/thiagosantana/projects/cint/engram
bun test tests/services/sync/
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/services/sqlite/migrations/runner.ts
git commit -m "fix: bump MigrationRunner createSyncQueueTable to version 27 to avoid collision"
```

---

## Task 2: Add `sync_queue` migration to `SessionStore`

**Context:** `SessionStore` has its own inline migration methods called from the constructor. Version 26 is taken by `addObservationModelColumns()`. Use version **27** here (now consistent with the updated `MigrationRunner`).

**Files:**
- Modify: `src/services/sqlite/SessionStore.ts`

- [ ] **Step 1: Add the import for SyncQueue at the top of SessionStore.ts**

At the top of the file, after existing imports, add:

```typescript
import type { SyncQueue } from '../sync/SyncQueue.js';
```

- [ ] **Step 2: Add `syncQueue` property and setter to the class**

After the `public db: Database;` line (line 35), add:

```typescript
private syncQueue: SyncQueue | null = null;

setSyncQueue(queue: SyncQueue): void {
  this.syncQueue = queue;
}
```

- [ ] **Step 3: Add `createSyncQueueTable()` private method**

After the closing `}` of `addObservationModelColumns()` (around line 945), add:

```typescript
/**
 * Create sync_queue table for multi-agent sync (migration 27)
 */
private createSyncQueueTable(): void {
  const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(27) as SchemaVersion | undefined;
  if (applied) return;

  this.db.run(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('observation', 'session', 'summary')),
      entity_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'synced', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at TEXT
    )
  `);

  this.db.run('CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status)');
  this.db.run('CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_type, entity_id)');

  this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(27, new Date().toISOString());
}
```

- [ ] **Step 4: Call the migration from the constructor**

In the constructor, after the `this.addObservationModelColumns();` line (line 67), add:

```typescript
this.createSyncQueueTable();
```

- [ ] **Step 5: Verify the migration runs (quick smoke test)**

```bash
cd /Users/thiagosantana/projects/cint/engram
bun -e "
import { SessionStore } from './src/services/sqlite/SessionStore.ts';
const s = new SessionStore(':memory:');
const tables = s.db.query(\"SELECT name FROM sqlite_master WHERE type='table'\").all();
console.log(tables.map((t: any) => t.name));
s.close();
"
```

Expected output includes `sync_queue` in the list.

- [ ] **Step 6: Commit**

```bash
git add src/services/sqlite/SessionStore.ts
git commit -m "feat: add sync_queue migration (v27) to SessionStore"
```

---

## Task 3: Enqueue after `storeObservation` and `storeSummary`

**Context:** Both methods return `{ id, createdAtEpoch }`. Enqueue the `id` before returning. Skip enqueue if deduplicated (observation already existed — `storeObservation` returns early with the existing row's id in that case, we should NOT re-enqueue that).

**Files:**
- Modify: `src/services/sqlite/SessionStore.ts`

- [ ] **Step 1: Add enqueue call in `storeObservation`**

In `storeObservation`, the dedup early-return is at line ~1729:
```typescript
if (existing) {
  return { id: existing.id, createdAtEpoch: existing.created_at_epoch };
}
```

After the `stmt.run(...)` call and before `return { id: Number(result.lastInsertRowid), ... }` (around line 1759), add:

```typescript
const id = Number(result.lastInsertRowid);
this.syncQueue?.enqueue('observation', id);
return { id, createdAtEpoch: timestampEpoch };
```

This replaces the existing `return { id: Number(result.lastInsertRowid), createdAtEpoch: timestampEpoch };` line.

- [ ] **Step 2: Add enqueue call in `storeSummary`**

After `stmt.run(...)` in `storeSummary` and before its `return` (around line 1810), apply the same pattern:

```typescript
const id = Number(result.lastInsertRowid);
this.syncQueue?.enqueue('summary', id);
return { id, createdAtEpoch: timestampEpoch };
```

This replaces the existing `return { id: Number(result.lastInsertRowid), createdAtEpoch: timestampEpoch };` line.

- [ ] **Step 3: Write the failing test**

Create `tests/services/sqlite/SessionStore.sync.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../../../src/services/sqlite/migrations/runner.js';
import { SessionStore } from '../../../src/services/sqlite/SessionStore.js';
import { SyncQueue } from '../../../src/services/sync/SyncQueue.js';

function createStore(): { store: SessionStore; queue: SyncQueue } {
  const store = new SessionStore(':memory:');
  const queue = new SyncQueue(store.db);
  store.setSyncQueue(queue);
  return { store, queue };
}

describe('SessionStore sync queue integration', () => {
  it('enqueues observation after storeObservation', () => {
    const { store, queue } = createStore();

    store.createSDKSession('test-content-id', '/test-project');
    store.updateMemorySessionId(1, 'test-memory-id');

    store.storeObservation('test-memory-id', '/test-project', {
      type: 'code',
      title: 'Test obs',
      subtitle: null,
      facts: [],
      narrative: 'some narrative',
      concepts: [],
      files_read: [],
      files_modified: [],
    });

    const status = queue.getStatus();
    expect(status.pending).toBe(1);

    const pending = queue.getPending(10);
    expect(pending[0].entity_type).toBe('observation');
    expect(pending[0].entity_id).toBe(1);
  });

  it('enqueues summary after storeSummary', () => {
    const { store, queue } = createStore();

    store.createSDKSession('test-content-id-2', '/test-project');
    store.updateMemorySessionId(1, 'test-memory-id-2');

    store.storeSummary('test-memory-id-2', '/test-project', {
      request: 'test request',
      investigated: 'test investigated',
      learned: 'test learned',
      completed: 'test completed',
      next_steps: 'test next steps',
      notes: null,
    });

    const status = queue.getStatus();
    expect(status.pending).toBe(1);

    const pending = queue.getPending(10);
    expect(pending[0].entity_type).toBe('summary');
  });

  it('does not enqueue deduplicated observations', () => {
    const { store, queue } = createStore();

    store.createSDKSession('test-content-id-3', '/test-project');
    store.updateMemorySessionId(1, 'test-memory-id-3');

    const obs = {
      type: 'code',
      title: 'Dup obs',
      subtitle: null,
      facts: [],
      narrative: 'same narrative',
      concepts: [],
      files_read: [],
      files_modified: [],
    };

    store.storeObservation('test-memory-id-3', '/test-project', obs);
    store.storeObservation('test-memory-id-3', '/test-project', obs); // duplicate

    // Only 1 should be enqueued (dedup hit returns early)
    expect(queue.getStatus().pending).toBe(1);
  });

  it('does not enqueue when no syncQueue set', () => {
    const store = new SessionStore(':memory:');
    // no setSyncQueue call

    store.createSDKSession('test-content-id-4', '/test-project');
    store.updateMemorySessionId(1, 'test-memory-id-4');

    // Should not throw
    expect(() => {
      store.storeObservation('test-memory-id-4', '/test-project', {
        type: 'code',
        title: 'No queue',
        subtitle: null,
        facts: [],
        narrative: 'narrative',
        concepts: [],
        files_read: [],
        files_modified: [],
      });
    }).not.toThrow();
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail (expected — enqueue not wired yet)**

```bash
cd /Users/thiagosantana/projects/cint/engram
bun test tests/services/sqlite/SessionStore.sync.test.ts
```

Expected: first 2 tests fail with `expect(received).toBe(1)` since enqueue hasn't been called yet. Last test should pass.

- [ ] **Step 5: Run tests again after wiring — verify they pass**

```bash
bun test tests/services/sqlite/SessionStore.sync.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/sqlite/SessionStore.ts tests/services/sqlite/SessionStore.sync.test.ts
git commit -m "feat: enqueue observation/summary into sync_queue after store"
```

---

## Task 4: Wire SyncWorker into `worker-service.ts`

**Context:** `worker-service.ts` initializes in `initialize()` (around line 350). Settings are loaded at line 354. `SearchManager` is created at line 388. Add the sync wiring block right after `searchManager` is created (after line 397). Add `syncWorker` to the class and stop it in `shutdown()`.

**Files:**
- Modify: `src/services/worker-service.ts`

- [ ] **Step 1: Add `syncWorker` property to the `WorkerService` class**

After the `private stopOrphanReaper: (() => void) | null = null;` line (around line 168), add:

```typescript
// Multi-agent sync worker
private syncWorker: import('./sync/SyncWorker.js').SyncWorker | null = null;
```

- [ ] **Step 2: Add sync initialization block in `initialize()`**

After the block ending with `logger.info('WORKER', 'SearchManager initialized and search routes registered');` (line 397), add:

```typescript
// Initialize multi-agent sync (non-blocking — disabled when settings not configured)
const syncEnabled = settings.CLAUDE_MEM_SYNC_ENABLED === true || settings.CLAUDE_MEM_SYNC_ENABLED === 'true';
const syncUrl = settings.CLAUDE_MEM_SYNC_SERVER_URL;
const syncApiKey = settings.CLAUDE_MEM_SYNC_API_KEY;
const syncAgentName = settings.CLAUDE_MEM_SYNC_AGENT_NAME;

if (syncEnabled && syncUrl && syncApiKey && syncAgentName) {
  try {
    const { SyncQueue } = await import('./sync/SyncQueue.js');
    const { SyncClient } = await import('./sync/SyncClient.js');
    const { SyncWorker } = await import('./sync/SyncWorker.js');

    const sessionStore = this.dbManager.getSessionStore();
    const syncQueue = new SyncQueue(sessionStore.db);
    sessionStore.setSyncQueue(syncQueue);

    const intervalMs = parseInt(settings.CLAUDE_MEM_SYNC_INTERVAL_MS || '30000', 10);
    const timeoutMs = parseInt(settings.CLAUDE_MEM_SYNC_TIMEOUT_MS || '3000', 10);
    const maxRetries = parseInt(settings.CLAUDE_MEM_SYNC_MAX_RETRIES || '5', 10);

    const syncClient = new SyncClient({
      serverUrl: syncUrl,
      apiKey: syncApiKey,
      agentName: syncAgentName,
      timeoutMs,
    });

    searchManager.setSyncClient(syncClient);

    this.syncWorker = new SyncWorker({
      enabled: true,
      queue: syncQueue,
      sessionStore,
      serverUrl: syncUrl,
      apiKey: syncApiKey,
      agentName: syncAgentName,
      intervalMs,
      timeoutMs,
      maxRetries,
      batchSize: 50,
    });

    this.syncWorker.start();
    logger.info('SYNC', `Multi-agent sync started`, { agentName: syncAgentName, serverUrl: syncUrl, intervalMs });
  } catch (error) {
    logger.error('SYNC', 'Failed to initialize sync (non-blocking)', {}, error as Error);
  }
} else {
  logger.info('SYNC', 'Multi-agent sync disabled or not configured');
}
```

- [ ] **Step 3: Stop `syncWorker` in `shutdown()`**

In `shutdown()`, after stopping `transcriptWatcher` (around line 964), add:

```typescript
if (this.syncWorker) {
  this.syncWorker.stop();
  this.syncWorker = null;
  logger.info('SYNC', 'Sync worker stopped');
}
```

- [ ] **Step 4: Commit**

```bash
git add src/services/worker-service.ts
git commit -m "feat: wire SyncWorker into worker service for multi-agent sync"
```

---

## Task 5: Build, deploy, and verify

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/thiagosantana/projects/cint/engram
bun test tests/services/sync/ tests/services/sqlite/SessionStore.sync.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Build and sync to installed plugin**

```bash
npm run build-and-sync
```

Expected: builds TypeScript, syncs to `~/.claude/plugins/marketplaces/thedotmack/`, restarts worker.

- [ ] **Step 3: Verify sync_queue table exists in production DB**

```bash
sqlite3 ~/.claude-mem/claude-mem.db ".tables" | tr ' ' '\n' | grep sync_queue
```

Expected: `sync_queue`

- [ ] **Step 4: Verify worker started with sync enabled**

```bash
tail -20 ~/.claude-mem/logs/worker-$(date +%Y-%m-%d).log | grep -i sync
```

Expected: log line like `[SYNC] Multi-agent sync started {agentName=thiago, serverUrl=https://engram-ashy.vercel.app, intervalMs=30000}`

- [ ] **Step 5: Trigger an observation and verify it queues**

```bash
sqlite3 ~/.claude-mem/claude-mem.db "SELECT * FROM sync_queue ORDER BY created_at DESC LIMIT 5;"
```

Expected: rows appear after the next Claude Code tool use.

- [ ] **Step 6: Verify push reaches Supabase**

After ~30 seconds (one sync tick), check:

```bash
sqlite3 ~/.claude-mem/claude-mem.db "SELECT status, COUNT(*) FROM sync_queue GROUP BY status;"
```

Expected: `synced|N` rows. If they stay `pending`, check worker logs for `[SYNC]` errors.

- [ ] **Step 7: Commit build artifacts**

```bash
git add plugin/scripts/worker-service.cjs plugin/scripts/context-generator.cjs
git commit -m "build: rebuild worker with sync pipeline wiring"
```
