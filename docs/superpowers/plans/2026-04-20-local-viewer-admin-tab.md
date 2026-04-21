# Local Viewer Admin Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Admin tab to the local React viewer (port 37777) that polls `GET /api/admin` every 10s and shows sync queue state, learning extraction stats, worker health, and recent errors.

**Architecture:** New `AdminRoutes` registered late (inside `initializeBackground`) aggregates data from `SyncQueue`, `SyncWorker`, `HealthChecker`, and an in-memory `ErrorStore`. Logger gains an `addSink` mechanism so ErrorStore intercepts warn/error writes. React viewer gains a tab bar with Sessions and Admin tabs.

**Tech Stack:** TypeScript, Bun, Express (via worker-service), React, SQLite3

**Spec:** `docs/superpowers/specs/2026-04-20-local-viewer-admin-tab-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/services/admin/ErrorStore.ts` | In-memory ring buffer, last 50 warn/error entries |
| Create | `src/services/admin/HealthChecker.ts` | Uptime, Chroma ping, sync server HTTP ping |
| Create | `src/services/admin/AdminRoutes.ts` | `GET /api/admin` aggregation endpoint |
| Create | `src/ui/viewer/components/AdminTab.tsx` | Admin tab React component |
| Create | `src/ui/viewer/components/SessionsTab.tsx` | Existing Feed content extracted into own component |
| Modify | `src/utils/logger.ts` | Add `addSink(fn)` / `removeSink(fn)` |
| Modify | `src/services/sync/SyncQueue.ts` | Add `getFailedItems(limit)`, update `markFailed(ids, errorMsg?)` |
| Modify | `src/services/sqlite/migrations.ts` | Add migration011: `last_error TEXT` on `sync_queue` |
| Modify | `src/services/sync/SyncWorker.ts` | Add `getExtractionStats()`, update `handlePushError` to pass error message |
| Modify | `src/services/worker-service.ts` | Wire `ErrorStore` + logger sink early; register `AdminRoutes` + `HealthChecker` in `initializeBackground` |
| Modify | `src/ui/viewer/App.tsx` | Add `activeTab` state + tab bar; render `SessionsTab` or `AdminTab` |

---

### Task 1: Add Logger sink mechanism

**Files:**
- Modify: `src/utils/logger.ts`
- Test: `src/utils/logger.test.ts` (new)

- [ ] **Step 1.1: Write the failing test**

```typescript
// src/utils/logger.test.ts
import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { Logger } from './logger';

describe('Logger.addSink', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger({ logDir: '/tmp/test-logs', maxLevel: 'debug' });
  });

  it('calls sink on error log', () => {
    const sink = vi.fn();
    logger.addSink(sink);
    logger.error('TEST', 'something broke');
    expect(sink).toHaveBeenCalledOnce();
    expect(sink.mock.calls[0][0]).toMatchObject({
      level: 'error',
      ctx: 'TEST',
      msg: 'something broke',
    });
  });

  it('calls sink on warn log', () => {
    const sink = vi.fn();
    logger.addSink(sink);
    logger.warn('TEST', 'heads up');
    expect(sink).toHaveBeenCalledOnce();
  });

  it('does not call sink on info log', () => {
    const sink = vi.fn();
    logger.addSink(sink);
    logger.info('TEST', 'informational');
    expect(sink).not.toHaveBeenCalled();
  });

  it('removeSink stops calls', () => {
    const sink = vi.fn();
    logger.addSink(sink);
    logger.removeSink(sink);
    logger.error('TEST', 'after remove');
    expect(sink).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
bun test src/utils/logger.test.ts
```
Expected: FAIL — `addSink is not a function`

- [ ] **Step 1.3: Add sink support to Logger**

In `src/utils/logger.ts`, add to the Logger class:

```typescript
export type LogSinkEntry = { ts: string; level: 'warn' | 'error'; ctx: string; msg: string };
type LogSink = (entry: LogSinkEntry) => void;

// Inside Logger class:
private sinks: LogSink[] = [];

addSink(fn: LogSink): void {
  this.sinks.push(fn);
}

removeSink(fn: LogSink): void {
  this.sinks = this.sinks.filter(s => s !== fn);
}

private notifySinks(level: 'warn' | 'error', ctx: string, msg: string): void {
  const entry: LogSinkEntry = { ts: new Date().toISOString(), level, ctx, msg };
  for (const sink of this.sinks) {
    try { sink(entry); } catch { /* sink errors must not crash logger */ }
  }
}
```

In the existing `warn(ctx, msg)` and `error(ctx, msg)` methods, call `this.notifySinks(level, ctx, msg)` after the file write.

- [ ] **Step 1.4: Run test to verify it passes**

```bash
bun test src/utils/logger.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 1.5: Commit**

```bash
git add src/utils/logger.ts src/utils/logger.test.ts
git commit -m "feat(admin): add Logger.addSink for error interception"
```

---

### Task 2: ErrorStore

**Files:**
- Create: `src/services/admin/ErrorStore.ts`
- Test: `src/services/admin/ErrorStore.test.ts`

- [ ] **Step 2.1: Write the failing test**

```typescript
// src/services/admin/ErrorStore.test.ts
import { describe, it, expect } from 'bun:test';
import { ErrorStore } from './ErrorStore';

describe('ErrorStore', () => {
  it('stores entries', () => {
    const store = new ErrorStore(5);
    store.push({ ts: '2026-01-01T00:00:00Z', level: 'error', ctx: 'X', msg: 'boom' });
    expect(store.getAll()).toHaveLength(1);
  });

  it('caps at limit, newest first', () => {
    const store = new ErrorStore(3);
    for (let i = 0; i < 5; i++) {
      store.push({ ts: `2026-01-01T00:00:0${i}Z`, level: 'error', ctx: 'X', msg: `msg${i}` });
    }
    const all = store.getAll();
    expect(all).toHaveLength(3);
    expect(all[0].msg).toBe('msg4'); // newest first
    expect(all[2].msg).toBe('msg2');
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
bun test src/services/admin/ErrorStore.test.ts
```
Expected: FAIL — cannot find module

- [ ] **Step 2.3: Implement ErrorStore**

```typescript
// src/services/admin/ErrorStore.ts
import type { LogSinkEntry } from '../../utils/logger';

export class ErrorStore {
  private entries: LogSinkEntry[] = [];

  constructor(private readonly cap: number = 50) {}

  push(entry: LogSinkEntry): void {
    this.entries.unshift(entry);
    if (this.entries.length > this.cap) {
      this.entries.length = this.cap;
    }
  }

  getAll(): LogSinkEntry[] {
    return [...this.entries];
  }
}
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
bun test src/services/admin/ErrorStore.test.ts
```
Expected: PASS

- [ ] **Step 2.5: Commit**

```bash
git add src/services/admin/ErrorStore.ts src/services/admin/ErrorStore.test.ts
git commit -m "feat(admin): add ErrorStore ring buffer"
```

---

### Task 3: SyncQueue migration + getFailedItems + markFailed update

**Files:**
- Modify: `src/services/sqlite/migrations.ts`
- Modify: `src/services/sync/SyncQueue.ts`
- Test: `src/services/sync/SyncQueue.test.ts` (add cases)

- [ ] **Step 3.1: Add SQLite migration for `last_error` column**

In `src/services/sqlite/migrations.ts`, add a new migration constant after the current last one:

```typescript
export const migration011: Migration = {
  version: 29,
  description: 'Add last_error column to sync_queue',
  up: `ALTER TABLE sync_queue ADD COLUMN last_error TEXT;`,
};
```

Add `migration011` to the exported `migrations` array.

- [ ] **Step 3.2: Write failing tests for new SyncQueue methods**

In `src/services/sync/SyncQueue.test.ts`, add:

```typescript
describe('getFailedItems', () => {
  it('returns failed items with last_error', async () => {
    const queue = new SyncQueue(':memory:');
    await queue.initialize();
    await queue.enqueue([{ id: 'obs-1', type: 'observation', payload: '{}' }]);
    const ids = (await queue.getStatus()).failed; // 0 initially
    // mark one item failed with error
    const pending = await queue.getPending(1);
    await queue.markFailed([pending[0].id], 'connection timeout');
    const failed = await queue.getFailedItems(10);
    expect(failed).toHaveLength(1);
    expect(failed[0].lastError).toBe('connection timeout');
    expect(failed[0].retries).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3.3: Run test to verify it fails**

```bash
bun test src/services/sync/SyncQueue.test.ts
```
Expected: FAIL

- [ ] **Step 3.4: Update `markFailed` and add `getFailedItems`**

In `src/services/sync/SyncQueue.ts`:

Update `markFailed` signature — `errorMsg` is one string applied to all ids in the batch (they fail together from the same HTTP/network error):
```typescript
async markFailed(ids: number[], errorMsg?: string): Promise<void> {
  // existing: increment retries for all ids
  // new: if errorMsg provided, also SET last_error = errorMsg for all ids
  // SQL pattern: UPDATE sync_queue SET retries = retries + 1, last_error = ? WHERE id IN (...)
}
```

Add `getFailedItems`:
```typescript
async getFailedItems(limit: number): Promise<Array<{
  id: number;
  type: string;
  retries: number;
  lastError: string | null;
}>> {
  return this.db.all(
    `SELECT id, type, retries, last_error as lastError
     FROM sync_queue WHERE status = 'failed'
     ORDER BY updated_at DESC LIMIT ?`,
    [limit]
  );
}
```

- [ ] **Step 3.5: Run test to verify it passes**

```bash
bun test src/services/sync/SyncQueue.test.ts
```
Expected: PASS

- [ ] **Step 3.6: Commit**

```bash
git add src/services/sqlite/migrations.ts src/services/sync/SyncQueue.ts src/services/sync/SyncQueue.test.ts
git commit -m "feat(admin): add last_error column + SyncQueue.getFailedItems"
```

---

### Task 4: SyncWorker extraction stats + handlePushError error message

**Files:**
- Modify: `src/services/sync/SyncWorker.ts`
- Test: `src/services/sync/SyncWorker.test.ts` (add cases)

- [ ] **Step 4.1: Write failing tests**

In `src/services/sync/SyncWorker.test.ts`, add:

```typescript
describe('getExtractionStats', () => {
  it('returns null before any run', () => {
    const worker = new SyncWorker(/* minimal config */);
    expect(worker.getExtractionStats()).toBeNull();
  });

  it('returns stats after extraction run', async () => {
    // stub extractSessionLearnings to return known result
    // verify getExtractionStats reflects it
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
bun test src/services/sync/SyncWorker.test.ts
```
Expected: FAIL

- [ ] **Step 4.3: Add stats tracking to SyncWorker**

Add private fields to the `SyncWorker` class declaration (top of class body):
```typescript
private lastExtractionAt: string | null = null;
private lastExtractionStats: {
  observationsProcessed: number;
  extracted: number;
  skipped: number;
  failed: number;
} | null = null;
```

`extractSessionLearnings()` already returns an array of extracted learnings. After each call, capture the result counts before continuing:
```typescript
const results = await this.learningExtractor.extract(sessionInput);
// results is Learning[] — count outcomes from it:
const extracted = results.filter(r => r.confidence >= this.config.confidenceThreshold).length;
const skipped = results.filter(r => r.confidence < this.config.confidenceThreshold).length;
this.lastExtractionAt = new Date().toISOString();
this.lastExtractionStats = {
  observationsProcessed: sessionInput.observations.length,
  extracted,
  skipped,
  failed: 0,   // increment in catch block if extraction throws
};
```

Wrap in try/catch and set `failed: 1` if extraction throws (don't let stats tracking crash the worker).

Add public getter (note: SyncWorker stores these as separate private fields — use `this.extractionEnabled` and `this.confidenceThreshold`, not `this.config.*`):
```typescript
getExtractionStats(): {
  enabled: boolean;
  threshold: number;
  lastRunAt: string | null;
  lastRunStats: typeof this.lastExtractionStats;
} | null {
  if (!this.extractionEnabled) return null;
  return {
    enabled: true,
    threshold: this.confidenceThreshold,
    lastRunAt: this.lastExtractionAt,
    lastRunStats: this.lastExtractionStats,
  };
}
```

Update `handlePushError` to pass error message:
```typescript
private handlePushError(error: any, ids: number[]): void {
  const statusMatch = error?.message?.match(/\((\d{3})\)/);
  const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;
  if (statusCode >= 400 && statusCode < 500) {
    this.queue.markFailedPermanently(ids);
  } else {
    this.queue.markFailed(ids, error?.message ?? 'unknown error');
  }
}
```

- [ ] **Step 4.4: Run test to verify it passes**

```bash
bun test src/services/sync/SyncWorker.test.ts
```
Expected: PASS

- [ ] **Step 4.5: Commit**

```bash
git add src/services/sync/SyncWorker.ts src/services/sync/SyncWorker.test.ts
git commit -m "feat(admin): SyncWorker extraction stats + error message in markFailed"
```

---

### Task 5: HealthChecker

**Files:**
- Create: `src/services/admin/HealthChecker.ts`
- Test: `src/services/admin/HealthChecker.test.ts`

- [ ] **Step 5.1: Write failing tests**

```typescript
// src/services/admin/HealthChecker.test.ts
import { describe, it, expect, mock } from 'bun:test';
import { HealthChecker } from './HealthChecker';

describe('HealthChecker', () => {
  it('returns ok when chroma healthy', async () => {
    const chromaManager = { isHealthy: mock(async () => true) };
    const checker = new HealthChecker({ chromaManager, syncServerUrl: null });
    const result = await checker.check();
    expect(result.chroma).toBe('ok');
  });

  it('returns error when chroma throws', async () => {
    const chromaManager = { isHealthy: mock(async () => { throw new Error('fail'); }) };
    const checker = new HealthChecker({ chromaManager, syncServerUrl: null });
    const result = await checker.check();
    expect(result.chroma).toBe('error');
  });

  it('returns unavailable when no chroma manager', async () => {
    const checker = new HealthChecker({ chromaManager: null, syncServerUrl: null });
    const result = await checker.check();
    expect(result.chroma).toBe('unavailable');
  });

  it('returns unavailable when no sync server url', async () => {
    const checker = new HealthChecker({ chromaManager: null, syncServerUrl: null });
    const result = await checker.check();
    expect(result.syncServer).toBe('unavailable');
  });

  it('includes uptimeSeconds and workerVersion', async () => {
    const checker = new HealthChecker({ chromaManager: null, syncServerUrl: null });
    const result = await checker.check();
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(result.workerVersion).toBeTypeOf('string');
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

```bash
bun test src/services/admin/HealthChecker.test.ts
```
Expected: FAIL

- [ ] **Step 5.3: Implement HealthChecker**

```typescript
// src/services/admin/HealthChecker.ts
import { version } from '../../../package.json';

type HealthStatus = 'ok' | 'error' | 'unavailable';

interface HealthCheckerConfig {
  chromaManager: { isHealthy(): Promise<boolean> } | null;
  syncServerUrl: string | null;
}

export interface HealthResult {
  uptimeSeconds: number;
  chroma: HealthStatus;
  syncServer: HealthStatus;
  workerVersion: string;
}

export class HealthChecker {
  constructor(private config: HealthCheckerConfig) {}

  async check(): Promise<HealthResult> {
    return {
      uptimeSeconds: Math.floor(process.uptime()),
      chroma: await this.checkChroma(),
      syncServer: await this.checkSyncServer(),
      workerVersion: version,
    };
  }

  private async checkChroma(): Promise<HealthStatus> {
    if (!this.config.chromaManager) return 'unavailable';
    try {
      const ok = await this.config.chromaManager.isHealthy();
      return ok ? 'ok' : 'error';
    } catch {
      return 'error';
    }
  }

  private async checkSyncServer(): Promise<HealthStatus> {
    if (!this.config.syncServerUrl) return 'unavailable';
    try {
      const res = await fetch(`${this.config.syncServerUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
      return res.ok ? 'ok' : 'error';
    } catch {
      return 'error';
    }
  }
}
```

- [ ] **Step 5.4: Run test to verify it passes**

```bash
bun test src/services/admin/HealthChecker.test.ts
```
Expected: PASS

- [ ] **Step 5.5: Commit**

```bash
git add src/services/admin/HealthChecker.ts src/services/admin/HealthChecker.test.ts
git commit -m "feat(admin): add HealthChecker for uptime/chroma/syncServer status"
```

---

### Task 6: AdminRoutes (GET /api/admin)

**Files:**
- Create: `src/services/admin/AdminRoutes.ts`
- Test: `src/services/admin/AdminRoutes.test.ts`

- [ ] **Step 6.1: Write failing test**

```typescript
// src/services/admin/AdminRoutes.test.ts
import { describe, it, expect, mock } from 'bun:test';
import express from 'express';
import request from 'supertest';
import { AdminRoutes } from './AdminRoutes';
import { ErrorStore } from './ErrorStore';

describe('GET /api/admin', () => {
  it('returns aggregated admin data', async () => {
    const app = express();

    const mockQueue = {
      getStatus: mock(async () => ({ pending: 2, failed: 1, synced: 10, permanently_failed: 0 })),
      getFailedItems: mock(async () => [{ id: 1, type: 'observation', retries: 2, lastError: 'timeout' }]),
    };
    const mockWorker = {
      getExtractionStats: mock(() => ({ enabled: true, threshold: 0.9, lastRunAt: null, lastRunStats: null })),
    };
    const mockHealth = {
      check: mock(async () => ({ uptimeSeconds: 100, chroma: 'ok', syncServer: 'ok', workerVersion: '1.0.0' })),
    };
    const errorStore = new ErrorStore(5);

    const routes = new AdminRoutes({ queue: mockQueue, syncWorker: mockWorker, healthChecker: mockHealth, errorStore });
    app.use(routes.router);

    const res = await request(app).get('/api/admin');
    expect(res.status).toBe(200);
    expect(res.body.syncQueue.pending).toBe(2);
    expect(res.body.syncQueue.failedItems).toHaveLength(1);
    expect(res.body.extraction.enabled).toBe(true);
    expect(res.body.health.chroma).toBe('ok');
    expect(res.body.fetchedAt).toBeTruthy();
  });

  it('returns null section on partial failure', async () => {
    const app = express();
    const mockQueue = { getStatus: mock(async () => { throw new Error('db error'); }), getFailedItems: mock(async () => []) };
    const mockWorker = { getExtractionStats: mock(() => null) };
    const mockHealth = { check: mock(async () => ({ uptimeSeconds: 0, chroma: 'unavailable', syncServer: 'unavailable', workerVersion: '1.0.0' })) };
    const errorStore = new ErrorStore(5);

    const routes = new AdminRoutes({ queue: mockQueue, syncWorker: mockWorker, healthChecker: mockHealth, errorStore });
    app.use(routes.router);

    const res = await request(app).get('/api/admin');
    expect(res.status).toBe(200);
    expect(res.body.syncQueue).toBeNull();
  });
});
```

- [ ] **Step 6.2: Run test to verify it fails**

```bash
bun test src/services/admin/AdminRoutes.test.ts
```
Expected: FAIL

- [ ] **Step 6.3: Implement AdminRoutes**

```typescript
// src/services/admin/AdminRoutes.ts
import { Router } from 'express';
import type { ErrorStore } from './ErrorStore';
import type { HealthChecker } from './HealthChecker';

interface AdminDeps {
  queue: {
    getStatus(): Promise<{ pending: number; failed: number }>;
    getFailedItems(limit: number): Promise<Array<{ id: number; type: string; retries: number; lastError: string | null }>>;
  };
  syncWorker: { getExtractionStats(): unknown } | null;
  healthChecker: HealthChecker;
  errorStore: ErrorStore;
}

export class AdminRoutes {
  readonly router = Router();

  constructor(private deps: AdminDeps) {
    this.router.get('/api/admin', this.handle.bind(this));
  }

  private async handle(req: any, res: any): Promise<void> {
    const [syncQueue, health, errors] = await Promise.all([
      this.getSyncQueue(),
      this.deps.healthChecker.check().catch(() => null),
      Promise.resolve(this.deps.errorStore.getAll()),
    ]);

    const extraction = this.deps.syncWorker?.getExtractionStats() ?? null;

    res.json({ syncQueue, extraction, health, errors, fetchedAt: new Date().toISOString() });
  }

  private async getSyncQueue() {
    try {
      const [status, failedItems] = await Promise.all([
        this.deps.queue.getStatus(),
        this.deps.queue.getFailedItems(10),
      ]);
      return { ...status, failedItems };
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 6.4: Run test to verify it passes**

```bash
bun test src/services/admin/AdminRoutes.test.ts
```
Expected: PASS

- [ ] **Step 6.5: Commit**

```bash
git add src/services/admin/AdminRoutes.ts src/services/admin/AdminRoutes.test.ts
git commit -m "feat(admin): add AdminRoutes GET /api/admin endpoint"
```

---

### Task 7: Wire everything in worker-service.ts

**Files:**
- Modify: `src/services/worker-service.ts`

No new test needed — integration covered by existing worker smoke tests. Manual verification in step 7.3.

- [ ] **Step 7.1: Wire ErrorStore + Logger sink early (in constructor or `start()`)**

In the constructor of `WorkerService` (before `initializeBackground`):

```typescript
import { ErrorStore } from './admin/ErrorStore';
// ...
this.errorStore = new ErrorStore(50);
logger.addSink(entry => this.errorStore.push(entry));
```

- [ ] **Step 7.2: Register AdminRoutes + HealthChecker in `initializeBackground`**

Following the CorpusRoutes pattern, inside `initializeBackground()`:

```typescript
import { HealthChecker } from './admin/HealthChecker';
import { AdminRoutes } from './admin/AdminRoutes';
// ...
const healthChecker = new HealthChecker({
  chromaManager: this.chromaMcpManager ?? null,
  syncServerUrl: this.settings.syncServerUrl ?? null,
});
this.server.registerRoutes(new AdminRoutes({
  queue: this.syncQueue,
  syncWorker: this.syncWorker ?? null,
  healthChecker,
  errorStore: this.errorStore,
}));
logger.info('WORKER', 'AdminRoutes registered');
```

- [ ] **Step 7.3: Verify endpoint responds**

Start the worker (`npm run build-and-sync` or restart worker), then:

```bash
curl http://localhost:37777/api/admin | jq .
```

Expected: JSON with `syncQueue`, `extraction`, `health`, `errors`, `fetchedAt` fields.

- [ ] **Step 7.4: Commit**

```bash
git add src/services/worker-service.ts
git commit -m "feat(admin): wire AdminRoutes, HealthChecker, ErrorStore in worker-service"
```

---

### Task 8: React tab infrastructure + AdminTab component

**Files:**
- Create: `src/ui/viewer/components/SessionsTab.tsx`
- Create: `src/ui/viewer/components/AdminTab.tsx`
- Modify: `src/ui/viewer/App.tsx`

No unit tests for UI components — verify visually in step 8.4.

- [ ] **Step 8.1: Extract SessionsTab**

Create `src/ui/viewer/components/SessionsTab.tsx` — move the current Feed rendering logic from App.tsx into this component. Props: same as Feed (`observations`, `summaries`, `prompts`, `isLoading`, `hasMore`, filter state, etc.).

- [ ] **Step 8.2: Add tab state to App.tsx**

In `src/ui/viewer/App.tsx`:

```typescript
const [activeTab, setActiveTab] = useState<'sessions' | 'admin'>('sessions');
```

Add tab bar JSX above the main content area:

```tsx
<div className="tab-bar">
  <button
    className={activeTab === 'sessions' ? 'tab active' : 'tab'}
    onClick={() => setActiveTab('sessions')}
  >Sessions</button>
  <button
    className={activeTab === 'admin' ? 'tab active' : 'tab'}
    onClick={() => setActiveTab('admin')}
  >Admin</button>
</div>
{activeTab === 'sessions' ? <SessionsTab {...sessionProps} /> : <AdminTab />}
```

Add CSS for `.tab-bar`, `.tab`, `.tab.active` to the viewer stylesheet.

- [ ] **Step 8.3: Create AdminTab component**

```tsx
// src/ui/viewer/components/AdminTab.tsx
import { useEffect, useRef, useState } from 'react';

interface AdminData {
  syncQueue: { pending: number; failed: number; lastFlushAt: string | null; failedItems: Array<{ id: number; type: string; retries: number; lastError: string | null }> } | null;
  extraction: { enabled: boolean; threshold: number; lastRunAt: string | null; lastRunStats: { observationsProcessed: number; extracted: number; skipped: number; failed: number } | null } | null;
  health: { uptimeSeconds: number; chroma: string; syncServer: string; workerVersion: string } | null;
  errors: Array<{ ts: string; level: string; ctx: string; msg: string }>;
  fetchedAt: string;
}

export function AdminTab() {
  const [data, setData] = useState<AdminData | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const fetchData = async () => {
    try {
      const res = await fetch('/api/admin');
      if (res.ok) {
        setData(await res.json());
        setSecondsAgo(0);
      }
    } catch {}
  };

  useEffect(() => {
    fetchData();

    // Poll every 10s only when tab visible
    intervalRef.current = setInterval(() => {
      if (!document.hidden) fetchData();
    }, 10_000);

    // Tick "seconds ago" counter every second
    const ticker = setInterval(() => setSecondsAgo(s => s + 1), 1000);

    return () => {
      clearInterval(intervalRef.current);
      clearInterval(ticker);
    };
  }, []);

  if (!data) return <div className="admin-loading">Loading admin data…</div>;

  return (
    <div className="admin-tab">
      <div className="admin-header">
        <span className="admin-fetched">last updated {secondsAgo}s ago</span>
      </div>

      {/* System Health */}
      <section className="admin-section">
        <h3>System Health</h3>
        {data.health ? (
          <div className="admin-health">
            <span>Worker {formatUptime(data.health.uptimeSeconds)}</span>
            <Badge status={data.health.chroma} label="Chroma" />
            <Badge status={data.health.syncServer} label="Sync server" />
            <span>v{data.health.workerVersion}</span>
          </div>
        ) : <p className="admin-unavailable">unavailable</p>}
      </section>

      {/* Sync Queue */}
      <section className="admin-section">
        <h3>Sync Queue</h3>
        {data.syncQueue ? (
          <>
            <p>{data.syncQueue.pending} pending · {data.syncQueue.failed} failed</p>
            {data.syncQueue.failedItems.length > 0 && (
              <details>
                <summary>Failed items ({data.syncQueue.failedItems.length})</summary>
                <ul className="admin-failed-items">
                  {data.syncQueue.failedItems.map(item => (
                    <li key={item.id}>{item.type} · {item.retries} retries · {item.lastError ?? 'unknown'}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        ) : <p className="admin-unavailable">unavailable</p>}
      </section>

      {/* Learning Extraction */}
      {data.extraction && (
        <section className="admin-section">
          <h3>Learning Extraction</h3>
          <p>
            <span className={`status-dot ${data.extraction.enabled ? 'green' : 'red'}`} />
            {data.extraction.enabled ? 'enabled' : 'disabled'} · threshold {data.extraction.threshold}
            {data.extraction.lastRunAt && ` · last run ${formatRelative(data.extraction.lastRunAt)}`}
          </p>
          {data.extraction.lastRunStats && (
            <p className="admin-extraction-stats">
              {data.extraction.lastRunStats.observationsProcessed} processed →{' '}
              {data.extraction.lastRunStats.extracted} extracted,{' '}
              {data.extraction.lastRunStats.skipped} skipped,{' '}
              {data.extraction.lastRunStats.failed} failed
            </p>
          )}
          {!data.extraction.lastRunAt && <p className="admin-muted">no runs yet</p>}
        </section>
      )}

      {/* Errors */}
      <section className="admin-section">
        <h3>Errors</h3>
        {data.errors.length === 0
          ? <p className="admin-muted">no errors</p>
          : (
            <ul className="admin-errors">
              {data.errors.map((e, i) => (
                <li key={i}>
                  <span className="admin-error-time">{formatTime(e.ts)}</span>
                  <span className={`admin-error-level ${e.level}`}>[{e.level}]</span>
                  <span className="admin-error-ctx">{e.ctx}</span>
                  <span className="admin-error-msg">{e.msg}</span>
                </li>
              ))}
            </ul>
          )
        }
      </section>
    </div>
  );
}

function Badge({ status, label }: { status: string; label: string }) {
  const color = status === 'ok' ? 'green' : status === 'error' ? 'red' : 'gray';
  return <span className={`admin-badge ${color}`}>{label} {status === 'ok' ? '✓' : status === 'unavailable' ? '—' : '✗'}</span>;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m up` : `${m}m up`;
}

function formatRelative(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
```

- [ ] **Step 8.4: Build and verify visually**

```bash
npm run build-and-sync
```

Open `http://127.0.0.1:37777` in browser. Verify:
- Tab bar shows "Sessions" and "Admin"
- Sessions tab shows existing feed (no regression)
- Admin tab loads and shows all 4 sections
- "last updated Xs ago" counter ticks
- Switching tabs doesn't break either view

- [ ] **Step 8.5: Commit**

```bash
git add src/ui/viewer/
git commit -m "feat(admin): add Admin tab to local viewer with health/queue/extraction/errors"
```

---

### Task 9: Full test run

- [ ] **Step 9.1: Run all tests**

```bash
bun test
```

Expected: all tests pass, no regressions.

- [ ] **Step 9.2: Commit if any fixes needed**

```bash
git add -p
git commit -m "fix(admin): test fixes after integration"
```
