# Multi-Agent Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-agent sync support so a team shares a persistent memory brain via a central Postgres server, while preserving the local-first SQLite experience.

**Architecture:** Local workers push observations asynchronously to a central Postgres-backed Express server. Search queries merge local SQLite results with team results from the server. Each agent authenticates via API key. The server is a new process mode in the same codebase (`engram server`).

**Tech Stack:** TypeScript, Express, bun:sqlite (local), postgres.js or pg (Postgres server), bun:test, Bun.password (bcrypt)

**Spec:** `docs/superpowers/specs/2026-04-14-multi-agent-sync-design.md`

---

## File Structure

### New files to create:

| File | Responsibility |
|------|---------------|
| `src/services/server/ServerService.ts` | Central server entry point (Express + Postgres, mirrors WorkerService pattern) |
| `src/services/server/PostgresManager.ts` | Postgres connection pool, query helpers, migration runner |
| `src/services/server/migrations/001-initial-schema.sql` | Server Postgres schema (agents, observations, sessions, summaries) |
| `src/services/server/http/routes/SyncRoutes.ts` | `/api/sync/push`, `/api/sync/status` endpoints |
| `src/services/server/http/routes/AgentRoutes.ts` | `/api/agents` CRUD endpoints |
| `src/services/server/http/routes/TeamSearchRoutes.ts` | `/api/search`, `/api/timeline` for team-wide queries |
| `src/services/server/auth/ApiKeyAuth.ts` | Middleware: extract Bearer token, hash, lookup agent |
| `src/services/server/auth/key-generator.ts` | Generate `cmem_ak_` prefixed API keys |
| `src/services/sync/SyncQueue.ts` | Local SQLite sync queue (enqueue, dequeue, mark synced/failed) |
| `src/services/sync/SyncWorker.ts` | Background loop: drain queue, batch POST to server, handle retries |
| `src/services/sync/SyncClient.ts` | HTTP client for talking to the central server |
| `src/npx-cli/commands/server.ts` | `engram server` subcommands (start, create-agent, list-agents, revoke-agent) |
| `src/npx-cli/commands/sync.ts` | `engram sync` subcommands (status, retry, pause, resume) |
| `docker/docker-compose.yml` | Postgres + engram-server compose file |
| `docker/Dockerfile.server` | Server container image |
| `tests/services/server/PostgresManager.test.ts` | Postgres connection and migration tests |
| `tests/services/server/auth/ApiKeyAuth.test.ts` | Auth middleware tests |
| `tests/services/server/routes/SyncRoutes.test.ts` | Sync push endpoint tests |
| `tests/services/server/routes/AgentRoutes.test.ts` | Agent CRUD tests |
| `tests/services/server/routes/TeamSearchRoutes.test.ts` | Team search tests |
| `tests/services/sync/SyncQueue.test.ts` | Local sync queue tests |
| `tests/services/sync/SyncWorker.test.ts` | Sync loop tests |
| `tests/services/sync/SyncClient.test.ts` | HTTP client tests |
| `tests/integration/sync-e2e.test.ts` | Full sync flow: local -> server -> team search |

### Files to modify:

| File | Change |
|------|--------|
| `src/services/sqlite/migrations/runner.ts` | Add migration 26: `sync_queue` table |
| `src/shared/SettingsDefaultsManager.ts` | Add 7 new `CLAUDE_MEM_SYNC_*` settings |
| `src/services/worker-service.ts` | Initialize SyncWorker in `initializeBackground()` |
| `src/services/worker/SearchManager.ts` | Add remote server query + merge in `search()` and `timeline()` |
| `src/npx-cli/index.ts` | Add `server` and `sync` command cases |
| `package.json` | Add `engram` bin entry, `pg` + `bcrypt` dependencies |
| `src/servers/mcp-server.ts` | Add `agent_name` and `source` fields to search/timeline responses |

---

## Task 1: Add Sync Settings to SettingsDefaultsManager

**Files:**
- Modify: `src/shared/SettingsDefaultsManager.ts`
- Test: `tests/shared/SettingsDefaultsManager.test.ts` (create if not exists)

- [ ] **Step 1: Write failing test for new sync settings**

Create `tests/shared/SettingsDefaultsManager.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { SettingsDefaultsManager } from '../../src/shared/SettingsDefaultsManager.js';

describe('SettingsDefaultsManager - Sync Settings', () => {
  it('should have sync settings with correct defaults', () => {
    const defaults = SettingsDefaultsManager.getAllDefaults();
    
    expect(defaults.CLAUDE_MEM_SYNC_ENABLED).toBe(false);
    expect(defaults.CLAUDE_MEM_SYNC_SERVER_URL).toBe('');
    expect(defaults.CLAUDE_MEM_SYNC_API_KEY).toBe('');
    expect(defaults.CLAUDE_MEM_SYNC_AGENT_NAME).toBe('');
    expect(defaults.CLAUDE_MEM_SYNC_INTERVAL_MS).toBe(30000);
    expect(defaults.CLAUDE_MEM_SYNC_TIMEOUT_MS).toBe(3000);
    expect(defaults.CLAUDE_MEM_SYNC_MAX_RETRIES).toBe(5);
  });

  it('should override sync settings from env vars', () => {
    // applyEnvOverrides is private — test via loadFromFile which calls it internally.
    // Set env vars before loading settings.
    process.env.CLAUDE_MEM_SYNC_ENABLED = 'true';
    process.env.CLAUDE_MEM_SYNC_SERVER_URL = 'https://test.example.com';
    
    // loadFromFile reads settings.json then applies env overrides.
    // Use a temp path that doesn't exist — it will create defaults then apply env.
    const tmpPath = '/tmp/claude-mem-test-settings-' + Date.now() + '.json';
    const settings = SettingsDefaultsManager.loadFromFile(tmpPath);
    
    expect(settings.CLAUDE_MEM_SYNC_ENABLED).toBe(true);
    expect(settings.CLAUDE_MEM_SYNC_SERVER_URL).toBe('https://test.example.com');
    
    delete process.env.CLAUDE_MEM_SYNC_ENABLED;
    delete process.env.CLAUDE_MEM_SYNC_SERVER_URL;
    
    // Clean up temp file
    try { require('fs').unlinkSync(tmpPath); } catch {}
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/shared/SettingsDefaultsManager.test.ts`
Expected: FAIL — `CLAUDE_MEM_SYNC_ENABLED` does not exist on `SettingsDefaults`

- [ ] **Step 3: Add sync settings to SettingsDefaults interface and DEFAULTS**

In `src/shared/SettingsDefaultsManager.ts`, add to the `SettingsDefaults` interface (around line 79, after the last existing key):

```typescript
// Sync settings
CLAUDE_MEM_SYNC_ENABLED: boolean;
CLAUDE_MEM_SYNC_SERVER_URL: string;
CLAUDE_MEM_SYNC_API_KEY: string;
CLAUDE_MEM_SYNC_AGENT_NAME: string;
CLAUDE_MEM_SYNC_INTERVAL_MS: number;
CLAUDE_MEM_SYNC_TIMEOUT_MS: number;
CLAUDE_MEM_SYNC_MAX_RETRIES: number;
```

Add to the `DEFAULTS` object (around line 160, after the last existing default):

```typescript
CLAUDE_MEM_SYNC_ENABLED: false,
CLAUDE_MEM_SYNC_SERVER_URL: '',
CLAUDE_MEM_SYNC_API_KEY: '',
CLAUDE_MEM_SYNC_AGENT_NAME: '',
CLAUDE_MEM_SYNC_INTERVAL_MS: 30000,
CLAUDE_MEM_SYNC_TIMEOUT_MS: 3000,
CLAUDE_MEM_SYNC_MAX_RETRIES: 5,
```

Make sure the `applyEnvOverrides` method handles boolean coercion for `CLAUDE_MEM_SYNC_ENABLED` (check how other boolean settings like `CLAUDE_MEM_CHROMA_ENABLED` are handled — follow the same pattern).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/shared/SettingsDefaultsManager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/SettingsDefaultsManager.ts tests/shared/SettingsDefaultsManager.test.ts
git commit -m "feat: add CLAUDE_MEM_SYNC_* settings for multi-agent sync"
```

---

## Task 2: Add sync_queue Table (SQLite Migration 26)

**Files:**
- Modify: `src/services/sqlite/migrations/runner.ts`
- Test: `tests/services/sqlite/sync-queue-migration.test.ts`

- [ ] **Step 1: Write failing test for sync_queue table**

Create `tests/services/sqlite/sync-queue-migration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../../../src/services/sqlite/migrations/runner.js';

describe('Migration 26: sync_queue table', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    const runner = new MigrationRunner(db);
    runner.runAllMigrations();
  });

  afterEach(() => {
    db.close();
  });

  it('should create sync_queue table with correct columns', () => {
    const columns = db.prepare("PRAGMA table_info('sync_queue')").all();
    const columnNames = columns.map((c: any) => c.name);
    
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('entity_type');
    expect(columnNames).toContain('entity_id');
    expect(columnNames).toContain('status');
    expect(columnNames).toContain('attempts');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('synced_at');
  });

  it('should be idempotent (safe to run twice)', () => {
    const runner = new MigrationRunner(db);
    runner.runAllMigrations(); // Second run
    
    const version = db.prepare('SELECT version FROM schema_versions WHERE version = 26').get();
    expect(version).toBeTruthy();
  });

  it('should default status to pending and attempts to 0', () => {
    db.prepare(`
      INSERT INTO sync_queue (entity_type, entity_id, created_at)
      VALUES ('observation', 1, datetime('now'))
    `).run();
    
    const row = db.prepare('SELECT status, attempts FROM sync_queue WHERE id = 1').get() as any;
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/services/sqlite/sync-queue-migration.test.ts`
Expected: FAIL — `sync_queue` table does not exist

- [ ] **Step 3: Add migration 26 to MigrationRunner**

In `src/services/sqlite/migrations/runner.ts`:

1. Add a new method after the last migration method (after `addSessionPlatformSourceColumn` or whichever is last):

```typescript
private createSyncQueueTable(): void {
  const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(26);
  if (applied) return;

  logger.debug('DB', 'Migration 26: Creating sync_queue table');

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

  this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(26, new Date().toISOString());
}
```

2. Call it from `runAllMigrations()`:

```typescript
this.createSyncQueueTable(); // Migration 26
```

**Important**: Check what the actual last migration number is in the current codebase. The exploration showed up to migration 25 (`addSessionPlatformSourceColumn`). If there are migrations 26 already, use 27. If the latest is 25, you could use 26. Read the `runAllMigrations()` method to confirm the exact next number.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/services/sqlite/sync-queue-migration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/sqlite/migrations/runner.ts tests/services/sqlite/sync-queue-migration.test.ts
git commit -m "feat: add sync_queue table (migration 26) for multi-agent sync"
```

---

## Task 3: Implement SyncQueue (Local Queue Manager)

**Files:**
- Create: `src/services/sync/SyncQueue.ts`
- Test: `tests/services/sync/SyncQueue.test.ts`

- [ ] **Step 1: Write failing tests for SyncQueue**

Create `tests/services/sync/SyncQueue.test.ts`:

```typescript
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
    expect(updated.status).toBe('pending'); // Still pending until max retries
  });

  it('should mark items as permanently failed after max retries', () => {
    queue.enqueue('observation', 42);
    const pending = queue.getPending(10);
    
    // Simulate 5 failures
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/services/sync/SyncQueue.test.ts`
Expected: FAIL — `SyncQueue` module does not exist

- [ ] **Step 3: Implement SyncQueue**

Create `src/services/sync/SyncQueue.ts`:

```typescript
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
    // Increment attempts, mark as 'failed' if exceeded max retries
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/services/sync/SyncQueue.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/sync/SyncQueue.ts tests/services/sync/SyncQueue.test.ts
git commit -m "feat: implement SyncQueue for local sync job management"
```

---

## Task 4: Implement SyncClient (HTTP Client for Central Server)

**Files:**
- Create: `src/services/sync/SyncClient.ts`
- Test: `tests/services/sync/SyncClient.test.ts`

- [ ] **Step 1: Write failing tests for SyncClient**

Create `tests/services/sync/SyncClient.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { SyncClient, SyncPushPayload, SyncPushResponse } from '../../../src/services/sync/SyncClient.js';

describe('SyncClient', () => {
  let client: SyncClient;

  beforeEach(() => {
    client = new SyncClient({
      serverUrl: 'http://localhost:9999',
      apiKey: 'cmem_ak_testkey123',
      agentName: 'TestAgent',
      timeoutMs: 3000,
    });
  });

  it('should construct correct push URL', () => {
    // Access internal for testing
    expect((client as any).buildUrl('/api/sync/push')).toBe('http://localhost:9999/api/sync/push');
  });

  it('should include Authorization header', () => {
    const headers = (client as any).buildHeaders();
    expect(headers['Authorization']).toBe('Bearer cmem_ak_testkey123');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('should build correct push payload structure', () => {
    const payload: SyncPushPayload = {
      observations: [
        {
          local_id: 42,
          content_hash: 'abc123',
          type: 'discovery',
          title: 'Test observation',
          subtitle: null,
          facts: ['fact1'],
          narrative: 'narrative text',
          concepts: ['concept1'],
          files_read: ['/path/file.ts'],
          files_modified: [],
          project: 'test-project',
          created_at: '2026-04-14T12:00:00Z',
          created_at_epoch: 1776355200,
          prompt_number: 5,
          model_used: 'claude-sonnet-4-20250514',
        },
      ],
      sessions: [],
      summaries: [],
    };

    expect(payload.observations).toHaveLength(1);
    expect(payload.observations[0].local_id).toBe(42);
  });

  it('should handle network errors gracefully', async () => {
    // Server not running on port 9999, should throw
    const payload: SyncPushPayload = { observations: [], sessions: [], summaries: [] };
    
    await expect(client.push(payload)).rejects.toThrow();
  });

  it('should handle timeout', async () => {
    const slowClient = new SyncClient({
      serverUrl: 'http://10.255.255.1', // Non-routable IP, will timeout
      apiKey: 'cmem_ak_testkey123',
      agentName: 'TestAgent',
      timeoutMs: 100, // Very short timeout
    });

    const payload: SyncPushPayload = { observations: [], sessions: [], summaries: [] };
    await expect(slowClient.push(payload)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/services/sync/SyncClient.test.ts`
Expected: FAIL — `SyncClient` module does not exist

- [ ] **Step 3: Implement SyncClient**

Create `src/services/sync/SyncClient.ts`:

```typescript
export interface SyncClientConfig {
  serverUrl: string;
  apiKey: string;
  agentName: string;
  timeoutMs: number;
}

export interface SyncObservationPayload {
  local_id: number;
  content_hash: string;
  type: string;
  title: string | null;
  subtitle: string | null;
  facts: string[];
  narrative: string | null;
  concepts: string[];
  files_read: string[];
  files_modified: string[];
  project: string;
  created_at: string;
  created_at_epoch: number;
  prompt_number: number | null;
  model_used: string | null;
}

export interface SyncSessionPayload {
  local_id: number;
  content_session_id: string;
  project: string;
  platform_source: string;
  user_prompt: string;
  custom_title: string | null;
  started_at: string;
  started_at_epoch: number;
  completed_at: string | null;
  completed_at_epoch: number | null;
  status: string;
}

export interface SyncSummaryPayload {
  local_id: number;
  local_session_id: number;
  project: string;
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
  files_read: string | null;
  files_edited: string | null;
  notes: string | null;
  created_at: string;
  created_at_epoch: number;
}

export interface SyncPushPayload {
  observations: SyncObservationPayload[];
  sessions: SyncSessionPayload[];
  summaries: SyncSummaryPayload[];
}

export interface SyncPushResponse {
  accepted: number;
  duplicates: number;
  errors: string[];
}

export interface SyncStatusResponse {
  agent_name: string;
  last_sync_at: string | null;
  observation_count: number;
  session_count: number;
}

export interface TeamSearchResult {
  observations: Array<{
    id: number;
    agent_name: string;
    source: 'team';
    type: string;
    title: string | null;
    subtitle: string | null;
    facts: string[];
    narrative: string | null;
    concepts: string[];
    files_read: string[];
    files_modified: string[];
    project: string;
    created_at: string;
    created_at_epoch: number;
  }>;
}

export class SyncClient {
  private serverUrl: string;
  private apiKey: string;
  private agentName: string;
  private timeoutMs: number;

  constructor(config: SyncClientConfig) {
    this.serverUrl = config.serverUrl.replace(/\/$/, ''); // Strip trailing slash
    this.apiKey = config.apiKey;
    this.agentName = config.agentName;
    this.timeoutMs = config.timeoutMs;
  }

  private buildUrl(path: string): string {
    return `${this.serverUrl}${path}`;
  }

  private buildHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async push(payload: SyncPushPayload): Promise<SyncPushResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.buildUrl('/api/sync/push'), {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Sync push failed (${response.status}): ${text}`);
      }

      return await response.json() as SyncPushResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getStatus(): Promise<SyncStatusResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.buildUrl('/api/sync/status'), {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Sync status failed (${response.status})`);
      }

      return await response.json() as SyncStatusResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  async searchTeam(query: string, params: Record<string, string> = {}): Promise<TeamSearchResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = new URL(this.buildUrl('/api/search'));
      url.searchParams.set('query', query);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Team search failed (${response.status})`);
      }

      return await response.json() as TeamSearchResult;
    } finally {
      clearTimeout(timeout);
    }
  }

  async timelineTeam(params: Record<string, string> = {}): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = new URL(this.buildUrl('/api/timeline'));
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Team timeline failed (${response.status})`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/services/sync/SyncClient.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/sync/SyncClient.ts tests/services/sync/SyncClient.test.ts
git commit -m "feat: implement SyncClient HTTP client for central server communication"
```

---

## Task 5: Implement SyncWorker (Background Sync Loop)

**Files:**
- Create: `src/services/sync/SyncWorker.ts`
- Test: `tests/services/sync/SyncWorker.test.ts`

- [ ] **Step 1: Write failing tests for SyncWorker**

Create `tests/services/sync/SyncWorker.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../../../src/services/sqlite/migrations/runner.js';
import { SyncQueue } from '../../../src/services/sync/SyncQueue.js';
import { SyncWorker } from '../../../src/services/sync/SyncWorker.js';
import { SyncClient } from '../../../src/services/sync/SyncClient.js';
import { SessionStore } from '../../../src/services/sqlite/SessionStore.js';

describe('SyncWorker', () => {
  let db: Database;
  let queue: SyncQueue;
  let sessionStore: SessionStore;

  beforeEach(() => {
    db = new Database(':memory:');
    const runner = new MigrationRunner(db);
    runner.runAllMigrations();
    queue = new SyncQueue(db);
    sessionStore = new SessionStore(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('should not run when sync is disabled', async () => {
    const worker = new SyncWorker({
      enabled: false,
      queue,
      sessionStore,
      serverUrl: 'http://localhost:9999',
      apiKey: 'cmem_ak_test',
      agentName: 'Test',
      intervalMs: 1000,
      timeoutMs: 3000,
      maxRetries: 5,
      batchSize: 100,
    });

    // Should not throw, just no-op
    await worker.tick();
    expect(queue.getStatus().pending).toBe(0);
  });

  it('should skip tick when queue is empty', async () => {
    const worker = new SyncWorker({
      enabled: true,
      queue,
      sessionStore,
      serverUrl: 'http://localhost:9999',
      apiKey: 'cmem_ak_test',
      agentName: 'Test',
      intervalMs: 1000,
      timeoutMs: 3000,
      maxRetries: 5,
      batchSize: 100,
    });

    // Empty queue, tick should be no-op
    await worker.tick();
    expect(queue.getStatus().pending).toBe(0);
  });

  it('should be pausable and resumable', () => {
    const worker = new SyncWorker({
      enabled: true,
      queue,
      sessionStore,
      serverUrl: 'http://localhost:9999',
      apiKey: 'cmem_ak_test',
      agentName: 'Test',
      intervalMs: 1000,
      timeoutMs: 3000,
      maxRetries: 5,
      batchSize: 100,
    });

    expect(worker.isPaused()).toBe(false);
    worker.pause();
    expect(worker.isPaused()).toBe(true);
    worker.resume();
    expect(worker.isPaused()).toBe(false);
  });

  it('should not drain when paused', async () => {
    const worker = new SyncWorker({
      enabled: true,
      queue,
      sessionStore,
      serverUrl: 'http://localhost:9999',
      apiKey: 'cmem_ak_test',
      agentName: 'Test',
      intervalMs: 1000,
      timeoutMs: 3000,
      maxRetries: 5,
      batchSize: 100,
    });

    queue.enqueue('observation', 42);
    worker.pause();
    await worker.tick();

    // Should still be pending because paused
    expect(queue.getStatus().pending).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/services/sync/SyncWorker.test.ts`
Expected: FAIL — `SyncWorker` module does not exist

- [ ] **Step 3: Implement SyncWorker**

Create `src/services/sync/SyncWorker.ts`:

```typescript
import { SyncQueue, SyncQueueItem } from './SyncQueue.js';
import { SyncClient, SyncPushPayload, SyncObservationPayload, SyncSessionPayload, SyncSummaryPayload } from './SyncClient.js';

// Import the SessionStore type — adjust path based on actual project structure.
// The SessionStore is used to look up full observation/session/summary data by ID.
// Check the actual import path in the codebase: likely '../sqlite/SessionStore.js'
import type { SessionStore } from '../sqlite/SessionStore.js';

export interface SyncWorkerConfig {
  enabled: boolean;
  queue: SyncQueue;
  sessionStore: SessionStore;
  serverUrl: string;
  apiKey: string;
  agentName: string;
  intervalMs: number;
  timeoutMs: number;
  maxRetries: number;
  batchSize: number;
}

export class SyncWorker {
  private enabled: boolean;
  private queue: SyncQueue;
  private sessionStore: SessionStore;
  private client: SyncClient;
  private intervalMs: number;
  private batchSize: number;
  private paused: boolean = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SyncWorkerConfig) {
    this.enabled = config.enabled;
    this.queue = config.queue;
    this.sessionStore = config.sessionStore;
    this.intervalMs = config.intervalMs;
    this.batchSize = config.batchSize;

    this.client = new SyncClient({
      serverUrl: config.serverUrl,
      apiKey: config.apiKey,
      agentName: config.agentName,
      timeoutMs: config.timeoutMs,
    });
  }

  start(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /**
   * One sync cycle. Exposed publicly for testing.
   * Drains up to batchSize items from the queue and pushes to server.
   */
  async tick(): Promise<void> {
    if (!this.enabled || this.paused) return;

    const pending = this.queue.getPending(this.batchSize);
    if (pending.length === 0) return;

    const payload = this.buildPayload(pending);
    const ids = pending.map((item) => item.id);

    try {
      const response = await this.client.push(payload);
      this.queue.markSynced(ids);
    } catch (error: any) {
      // Distinguish 4xx (permanent) from network/5xx (retryable).
      // SyncClient throws with status code in message: "Sync push failed (400): ..."
      const statusMatch = error.message?.match(/\((\d{3})\)/);
      const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;

      if (statusCode >= 400 && statusCode < 500) {
        // 4xx — permanent failure per spec. Mark as failed immediately.
        this.queue.markFailedPermanently(ids);
      } else {
        // Network error or 5xx — increment attempts, retry later
        this.queue.markFailed(ids);
      }
    }
  }

  private buildPayload(items: SyncQueueItem[]): SyncPushPayload {
    const observations: SyncObservationPayload[] = [];
    const sessions: SyncSessionPayload[] = [];
    const summaries: SyncSummaryPayload[] = [];

    for (const item of items) {
      switch (item.entity_type) {
        case 'observation': {
          // Look up full observation data from SessionStore by ID
          // The exact method name depends on what SessionStore exposes.
          // Check SessionStore for a method like getObservationById(id).
          // If none exists, you'll need to add one — a simple:
          //   this.db.prepare('SELECT * FROM observations WHERE id = ?').get(id)
          const obs = this.sessionStore.getObservationById(item.entity_id);
          if (obs) {
            observations.push({
              local_id: obs.id,
              content_hash: obs.content_hash || '',
              type: obs.type,
              title: obs.title,
              subtitle: obs.subtitle,
              facts: this.parseJsonArray(obs.facts),
              narrative: obs.narrative,
              concepts: this.parseJsonArray(obs.concepts),
              files_read: this.parseJsonArray(obs.files_read),
              files_modified: this.parseJsonArray(obs.files_modified),
              project: obs.project,
              created_at: obs.created_at,
              created_at_epoch: obs.created_at_epoch,
              prompt_number: obs.prompt_number,
              model_used: obs.model_used,
            });
          }
          break;
        }
        case 'session': {
          // Similar: look up session by ID from SessionStore
          // Add a getSessionById(id) method if needed
          const session = this.sessionStore.getSessionById(item.entity_id);
          if (session) {
            sessions.push({
              local_id: session.id,
              content_session_id: session.content_session_id,
              project: session.project,
              platform_source: session.platform_source || 'claude',
              user_prompt: session.user_prompt,
              custom_title: session.custom_title,
              started_at: session.started_at,
              started_at_epoch: session.started_at_epoch,
              completed_at: session.completed_at,
              completed_at_epoch: session.completed_at_epoch,
              status: session.status,
            });
          }
          break;
        }
        case 'summary': {
          // Look up summary by ID
          const summary = this.sessionStore.getSummaryById(item.entity_id);
          if (summary) {
            summaries.push({
              local_id: summary.id,
              local_session_id: summary.memory_session_id,
              project: summary.project,
              request: summary.request,
              investigated: summary.investigated,
              learned: summary.learned,
              completed: summary.completed,
              next_steps: summary.next_steps,
              files_read: summary.files_read,
              files_edited: summary.files_edited,
              notes: summary.notes,
              created_at: summary.created_at,
              created_at_epoch: summary.created_at_epoch,
            });
          }
          break;
        }
      }
    }

    return { observations, sessions, summaries };
  }

  private parseJsonArray(value: string | string[] | null): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
      return JSON.parse(value);
    } catch {
      return [value];
    }
  }
}
```

**Important**: The `SessionStore` may not have `getObservationById`, `getSessionById`, or `getSummaryById` methods. Check the actual `SessionStore.ts` (2675 lines). If these methods don't exist, you'll need to add them in a preparatory step. They're simple single-row lookups:

```typescript
getObservationById(id: number): any {
  return this.db.prepare('SELECT * FROM observations WHERE id = ?').get(id);
}
getSessionById(id: number): any {
  return this.db.prepare('SELECT * FROM sdk_sessions WHERE id = ?').get(id);
}
getSummaryById(id: number): any {
  return this.db.prepare('SELECT * FROM session_summaries WHERE id = ?').get(id);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/services/sync/SyncWorker.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/sync/SyncWorker.ts tests/services/sync/SyncWorker.test.ts
git commit -m "feat: implement SyncWorker background sync loop"
```

---

## Task 6: Implement API Key Auth Module

**Files:**
- Create: `src/services/server/auth/key-generator.ts`
- Create: `src/services/server/auth/ApiKeyAuth.ts`
- Test: `tests/services/server/auth/ApiKeyAuth.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/services/server/auth/ApiKeyAuth.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { generateApiKey, hashApiKey, verifyApiKey } from '../../../src/services/server/auth/key-generator.js';

describe('API Key Generation', () => {
  it('should generate key with cmem_ak_ prefix', () => {
    const key = generateApiKey();
    expect(key.startsWith('cmem_ak_')).toBe(true);
  });

  it('should generate unique keys', () => {
    const key1 = generateApiKey();
    const key2 = generateApiKey();
    expect(key1).not.toBe(key2);
  });

  it('should generate key of sufficient length', () => {
    const key = generateApiKey();
    // cmem_ak_ (8 chars) + at least 32 chars of random
    expect(key.length).toBeGreaterThanOrEqual(40);
  });

  it('should hash and verify correctly', async () => {
    const key = generateApiKey();
    const hash = await hashApiKey(key);
    
    expect(hash).not.toBe(key);
    expect(await verifyApiKey(key, hash)).toBe(true);
    expect(await verifyApiKey('wrong_key', hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/services/server/auth/ApiKeyAuth.test.ts`
Expected: FAIL — modules don't exist

- [ ] **Step 3: Implement key-generator**

Create `src/services/server/auth/key-generator.ts`:

```typescript
import { randomBytes } from 'crypto';

const PREFIX = 'cmem_ak_';

export function generateApiKey(): string {
  const random = randomBytes(32).toString('hex');
  return `${PREFIX}${random}`;
}

export async function hashApiKey(key: string): Promise<string> {
  // Use Bun's built-in password hashing (bcrypt-compatible)
  return await Bun.password.hash(key, { algorithm: 'bcrypt', cost: 10 });
}

export async function verifyApiKey(key: string, hash: string): Promise<boolean> {
  return await Bun.password.verify(key, hash);
}
```

- [ ] **Step 4: Implement ApiKeyAuth middleware**

Create `src/services/server/auth/ApiKeyAuth.ts`:

```typescript
import type { Request, Response, NextFunction } from 'express';
import { verifyApiKey } from './key-generator.js';

export interface Agent {
  id: string;
  name: string;
  api_key_hash: string;
  status: string;
  created_at: string;
}

/**
 * Factory: creates Express middleware that authenticates requests via Bearer token.
 * `findAgentByKeyPrefix` is injected so this module doesn't depend on Postgres directly.
 * 
 * The lookup strategy: since bcrypt hashes can't be reversed, we need a way to find
 * the agent without hashing against every row. Store the first 8 chars of the key
 * (after prefix) as `api_key_prefix` for fast lookup, then verify the full hash.
 */
export function createApiKeyAuth(
  getActiveAgents: () => Promise<Agent[]>
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const apiKey = authHeader.slice(7); // Remove 'Bearer '
    if (!apiKey.startsWith('cmem_ak_')) {
      res.status(401).json({ error: 'Invalid API key format' });
      return;
    }

    try {
      const agents = await getActiveAgents();
      for (const agent of agents) {
        if (await verifyApiKey(apiKey, agent.api_key_hash)) {
          // Attach agent to request for downstream handlers
          (req as any).agent = agent;
          next();
          return;
        }
      }

      res.status(401).json({ error: 'Invalid API key' });
    } catch (error) {
      res.status(500).json({ error: 'Authentication error' });
    }
  };
}
```

**Note on performance**: Iterating all agents and running bcrypt verify for each is O(n) per request. For teams of 5-20 this is fine. For v2, add an `api_key_prefix` column (first 8 chars after `cmem_ak_`) for fast lookup, then verify only the matching agent. Not needed for v1.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/services/server/auth/ApiKeyAuth.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/server/auth/ tests/services/server/auth/
git commit -m "feat: implement API key generation, hashing, and auth middleware"
```

---

## Task 7: Implement PostgresManager (Server Database Layer)

**Files:**
- Create: `src/services/server/PostgresManager.ts`
- Create: `src/services/server/migrations/001-initial-schema.sql`
- Test: `tests/services/server/PostgresManager.test.ts`

**Important**: This task requires a Postgres instance for testing. Tests should skip gracefully if Postgres is not available. Use environment variable `TEST_DATABASE_URL` to point to a test database.

- [ ] **Step 1: Write the SQL migration**

Create `src/services/server/migrations/001-initial-schema.sql`:

```sql
-- Migration 001: Initial schema for multi-agent sync server

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Agents table
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL UNIQUE,
  api_key_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);

-- Observations table (mirrors local SQLite with agent attribution)
CREATE TABLE IF NOT EXISTS observations (
  id SERIAL PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES agents(id),
  local_id INTEGER NOT NULL,
  content_hash VARCHAR(128) NOT NULL,
  type VARCHAR(50) NOT NULL,
  title TEXT,
  subtitle TEXT,
  facts JSONB DEFAULT '[]',
  narrative TEXT,
  concepts JSONB DEFAULT '[]',
  files_read JSONB DEFAULT '[]',
  files_modified JSONB DEFAULT '[]',
  project VARCHAR(500) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_at_epoch BIGINT NOT NULL,
  prompt_number INTEGER,
  model_used VARCHAR(255),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agent_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_observations_agent ON observations(agent_id);
CREATE INDEX IF NOT EXISTS idx_observations_project ON observations(project);
CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_content_hash ON observations(content_hash);

-- Full-text search vector column
ALTER TABLE observations ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;

CREATE INDEX IF NOT EXISTS idx_observations_search ON observations USING GIN(search_vector);

-- Trigger to auto-update search_vector
CREATE OR REPLACE FUNCTION observations_search_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.narrative, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(
      array_to_string(
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(NEW.facts, '[]'::jsonb))),
        ' '
      ), ''
    )), 'C') ||
    setweight(to_tsvector('english', COALESCE(
      array_to_string(
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(NEW.concepts, '[]'::jsonb))),
        ' '
      ), ''
    )), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_observations_search ON observations;
CREATE TRIGGER trg_observations_search
  BEFORE INSERT OR UPDATE ON observations
  FOR EACH ROW
  EXECUTE FUNCTION observations_search_trigger();

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES agents(id),
  local_session_id INTEGER NOT NULL,
  content_session_id VARCHAR(255) NOT NULL,
  project VARCHAR(500) NOT NULL,
  platform_source VARCHAR(50) DEFAULT 'claude',
  user_prompt TEXT,
  custom_title TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  started_at_epoch BIGINT NOT NULL,
  completed_at TIMESTAMPTZ,
  completed_at_epoch BIGINT,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agent_id, local_session_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);

-- Session summaries table
CREATE TABLE IF NOT EXISTS session_summaries (
  id SERIAL PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES agents(id),
  local_summary_id INTEGER NOT NULL,
  local_session_id INTEGER NOT NULL,
  project VARCHAR(500) NOT NULL,
  request TEXT,
  investigated TEXT,
  learned TEXT,
  completed TEXT,
  next_steps TEXT,
  files_read TEXT,
  files_edited TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  created_at_epoch BIGINT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agent_id, local_summary_id)
);

CREATE INDEX IF NOT EXISTS idx_summaries_agent ON session_summaries(agent_id);

-- Schema versions tracking
CREATE TABLE IF NOT EXISTS schema_versions (
  id SERIAL PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_versions (version) VALUES (1) ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Write failing tests for PostgresManager**

Create `tests/services/server/PostgresManager.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { PostgresManager } from '../../../src/services/server/PostgresManager.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

// Skip all tests if no test database configured
const describeWithDb = TEST_DB_URL ? describe : describe.skip;

describeWithDb('PostgresManager', () => {
  let pg: PostgresManager;

  beforeAll(async () => {
    pg = new PostgresManager(TEST_DB_URL!);
    await pg.connect();
    await pg.runMigrations();
  });

  afterAll(async () => {
    // Clean up test data
    await pg.query('DELETE FROM session_summaries');
    await pg.query('DELETE FROM observations');
    await pg.query('DELETE FROM sessions');
    await pg.query('DELETE FROM agents');
    await pg.close();
  });

  beforeEach(async () => {
    await pg.query('DELETE FROM session_summaries');
    await pg.query('DELETE FROM observations');
    await pg.query('DELETE FROM sessions');
    await pg.query('DELETE FROM agents');
  });

  it('should create an agent', async () => {
    const agent = await pg.createAgent('TestAgent', 'hashed_key_123');
    expect(agent.id).toBeDefined();
    expect(agent.name).toBe('TestAgent');
    expect(agent.status).toBe('active');
  });

  it('should reject duplicate agent names', async () => {
    await pg.createAgent('DupeAgent', 'hash1');
    await expect(pg.createAgent('DupeAgent', 'hash2')).rejects.toThrow();
  });

  it('should list active agents', async () => {
    await pg.createAgent('Agent1', 'hash1');
    await pg.createAgent('Agent2', 'hash2');
    
    const agents = await pg.getActiveAgents();
    expect(agents).toHaveLength(2);
  });

  it('should revoke an agent', async () => {
    await pg.createAgent('RevokeMe', 'hash1');
    await pg.revokeAgent('RevokeMe');
    
    const agents = await pg.getActiveAgents();
    expect(agents).toHaveLength(0);
  });

  it('should insert observation with dedup', async () => {
    const agent = await pg.createAgent('ObsAgent', 'hash1');
    
    const obs = {
      agent_id: agent.id,
      local_id: 42,
      content_hash: 'abc123',
      type: 'discovery',
      title: 'Test obs',
      subtitle: null,
      facts: ['fact1'],
      narrative: 'narrative',
      concepts: ['concept1'],
      files_read: ['/file.ts'],
      files_modified: [],
      project: 'test-project',
      created_at: new Date().toISOString(),
      created_at_epoch: Date.now(),
      prompt_number: 5,
      model_used: 'claude-sonnet-4-20250514',
    };

    const result1 = await pg.insertObservation(obs);
    expect(result1.inserted).toBe(true);

    // Duplicate should be ignored
    const result2 = await pg.insertObservation(obs);
    expect(result2.inserted).toBe(false);
  });

  it('should search observations with full-text search', async () => {
    const agent = await pg.createAgent('SearchAgent', 'hash1');
    
    await pg.insertObservation({
      agent_id: agent.id,
      local_id: 1,
      content_hash: 'hash1',
      type: 'discovery',
      title: 'Database migration patterns',
      subtitle: null,
      facts: ['uses SQLite'],
      narrative: 'Explored database migration patterns in the codebase',
      concepts: ['database', 'migration'],
      files_read: [],
      files_modified: [],
      project: 'test',
      created_at: new Date().toISOString(),
      created_at_epoch: Date.now(),
      prompt_number: 1,
      model_used: null,
    });

    const results = await pg.searchObservations('database migration', { limit: 10 });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Database migration patterns');
    expect(results[0].agent_name).toBe('SearchAgent');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/claude_mem_test bun test tests/services/server/PostgresManager.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 4: Implement PostgresManager**

Create `src/services/server/PostgresManager.ts`:

```typescript
import pg from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface AgentRecord {
  id: string;
  name: string;
  api_key_hash: string;
  status: string;
  created_at: string;
}

export interface ObservationInsert {
  agent_id: string;
  local_id: number;
  content_hash: string;
  type: string;
  title: string | null;
  subtitle: string | null;
  facts: string[];
  narrative: string | null;
  concepts: string[];
  files_read: string[];
  files_modified: string[];
  project: string;
  created_at: string;
  created_at_epoch: number;
  prompt_number: number | null;
  model_used: string | null;
}

export interface SessionInsert {
  agent_id: string;
  local_session_id: number;
  content_session_id: string;
  project: string;
  platform_source: string;
  user_prompt: string | null;
  custom_title: string | null;
  started_at: string;
  started_at_epoch: number;
  completed_at: string | null;
  completed_at_epoch: number | null;
  status: string;
}

export interface SummaryInsert {
  agent_id: string;
  local_summary_id: number;
  local_session_id: number;
  project: string;
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
  files_read: string | null;
  files_edited: string | null;
  notes: string | null;
  created_at: string;
  created_at_epoch: number;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  project?: string;
  type?: string;
  agent?: string;
}

export interface ObservationSearchResult {
  id: number;
  agent_name: string;
  source: 'team';
  type: string;
  title: string | null;
  subtitle: string | null;
  facts: string[];
  narrative: string | null;
  concepts: string[];
  files_read: string[];
  files_modified: string[];
  project: string;
  created_at: string;
  created_at_epoch: number;
}

export class PostgresManager {
  private pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }

  async connect(): Promise<void> {
    // Test connection
    const client = await this.pool.connect();
    client.release();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async query(text: string, params?: any[]): Promise<pg.QueryResult> {
    return this.pool.query(text, params);
  }

  async runMigrations(): Promise<void> {
    const sqlPath = join(__dirname, 'migrations', '001-initial-schema.sql');
    const sql = readFileSync(sqlPath, 'utf-8');
    await this.pool.query(sql);
  }

  // --- Agent operations ---

  async createAgent(name: string, apiKeyHash: string): Promise<AgentRecord> {
    const result = await this.pool.query(
      `INSERT INTO agents (name, api_key_hash) VALUES ($1, $2) RETURNING *`,
      [name, apiKeyHash]
    );
    return result.rows[0];
  }

  async getActiveAgents(): Promise<AgentRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM agents WHERE status = 'active' ORDER BY name`
    );
    return result.rows;
  }

  async getAgentByName(name: string): Promise<AgentRecord | null> {
    const result = await this.pool.query(
      `SELECT * FROM agents WHERE name = $1`,
      [name]
    );
    return result.rows[0] || null;
  }

  async revokeAgent(name: string): Promise<void> {
    await this.pool.query(
      `UPDATE agents SET status = 'revoked' WHERE name = $1`,
      [name]
    );
  }

  // --- Observation operations ---

  async insertObservation(obs: ObservationInsert): Promise<{ inserted: boolean }> {
    const result = await this.pool.query(
      `INSERT INTO observations (
        agent_id, local_id, content_hash, type, title, subtitle,
        facts, narrative, concepts, files_read, files_modified,
        project, created_at, created_at_epoch, prompt_number, model_used
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (agent_id, content_hash) DO NOTHING`,
      [
        obs.agent_id, obs.local_id, obs.content_hash, obs.type,
        obs.title, obs.subtitle,
        JSON.stringify(obs.facts), obs.narrative,
        JSON.stringify(obs.concepts),
        JSON.stringify(obs.files_read), JSON.stringify(obs.files_modified),
        obs.project, obs.created_at, obs.created_at_epoch,
        obs.prompt_number, obs.model_used,
      ]
    );
    // ON CONFLICT DO NOTHING sets rowCount to 0 for duplicates
    return { inserted: (result.rowCount ?? 0) > 0 };
  }

  async insertObservationBatch(observations: ObservationInsert[]): Promise<{ accepted: number; duplicates: number }> {
    let accepted = 0;
    let duplicates = 0;
    for (const obs of observations) {
      const result = await this.insertObservation(obs);
      if (result.inserted) accepted++;
      else duplicates++;
    }
    return { accepted, duplicates };
  }

  // --- Session operations ---

  async insertSession(session: SessionInsert): Promise<{ inserted: boolean }> {
    const result = await this.pool.query(
      `INSERT INTO sessions (
        agent_id, local_session_id, content_session_id, project,
        platform_source, user_prompt, custom_title,
        started_at, started_at_epoch, completed_at, completed_at_epoch, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (agent_id, local_session_id) DO NOTHING`,
      [
        session.agent_id, session.local_session_id, session.content_session_id,
        session.project, session.platform_source, session.user_prompt,
        session.custom_title, session.started_at, session.started_at_epoch,
        session.completed_at, session.completed_at_epoch, session.status,
      ]
    );
    return { inserted: (result.rowCount ?? 0) > 0 };
  }

  // --- Summary operations ---

  async insertSummary(summary: SummaryInsert): Promise<{ inserted: boolean }> {
    const result = await this.pool.query(
      `INSERT INTO session_summaries (
        agent_id, local_summary_id, local_session_id, project,
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, created_at, created_at_epoch
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (agent_id, local_summary_id) DO NOTHING`,
      [
        summary.agent_id, summary.local_summary_id, summary.local_session_id,
        summary.project, summary.request, summary.investigated,
        summary.learned, summary.completed, summary.next_steps,
        summary.files_read, summary.files_edited, summary.notes,
        summary.created_at, summary.created_at_epoch,
      ]
    );
    return { inserted: (result.rowCount ?? 0) > 0 };
  }

  // --- Search operations ---

  async searchObservations(query: string, options: SearchOptions = {}): Promise<ObservationSearchResult[]> {
    const limit = options.limit || 20;
    const offset = options.offset || 0;
    
    let whereClause = `WHERE 1=1`;
    const params: any[] = [];
    let paramIndex = 1;

    if (query) {
      whereClause += ` AND o.search_vector @@ plainto_tsquery('english', $${paramIndex})`;
      params.push(query);
      paramIndex++;
    }

    if (options.project) {
      whereClause += ` AND o.project = $${paramIndex}`;
      params.push(options.project);
      paramIndex++;
    }

    if (options.type) {
      whereClause += ` AND o.type = $${paramIndex}`;
      params.push(options.type);
      paramIndex++;
    }

    if (options.agent) {
      whereClause += ` AND a.name = $${paramIndex}`;
      params.push(options.agent);
      paramIndex++;
    }

    const orderClause = query
      ? `ORDER BY ts_rank_cd(o.search_vector, plainto_tsquery('english', $1)) DESC, o.created_at DESC`
      : `ORDER BY o.created_at DESC`;

    params.push(limit, offset);

    const result = await this.pool.query(
      `SELECT o.id, a.name as agent_name, 'team' as source,
              o.type, o.title, o.subtitle, o.facts, o.narrative,
              o.concepts, o.files_read, o.files_modified,
              o.project, o.created_at, o.created_at_epoch
       FROM observations o
       JOIN agents a ON o.agent_id = a.id
       ${whereClause}
       ${orderClause}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    return result.rows.map((row: any) => ({
      ...row,
      facts: row.facts || [],
      concepts: row.concepts || [],
      files_read: row.files_read || [],
      files_modified: row.files_modified || [],
    }));
  }

  async getTimeline(options: SearchOptions = {}): Promise<ObservationSearchResult[]> {
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (options.project) {
      whereClause += ` AND o.project = $${paramIndex}`;
      params.push(options.project);
      paramIndex++;
    }

    if (options.agent) {
      whereClause += ` AND a.name = $${paramIndex}`;
      params.push(options.agent);
      paramIndex++;
    }

    params.push(limit, offset);

    const result = await this.pool.query(
      `SELECT o.id, a.name as agent_name, 'team' as source,
              o.type, o.title, o.subtitle, o.facts, o.narrative,
              o.concepts, o.files_read, o.files_modified,
              o.project, o.created_at, o.created_at_epoch
       FROM observations o
       JOIN agents a ON o.agent_id = a.id
       ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    return result.rows;
  }

  async getAgentSyncStatus(agentId: string): Promise<{
    last_sync_at: string | null;
    observation_count: number;
    session_count: number;
  }> {
    const obsResult = await this.pool.query(
      `SELECT COUNT(*) as count, MAX(synced_at) as last_sync
       FROM observations WHERE agent_id = $1`,
      [agentId]
    );
    const sessResult = await this.pool.query(
      `SELECT COUNT(*) as count FROM sessions WHERE agent_id = $1`,
      [agentId]
    );

    return {
      last_sync_at: obsResult.rows[0]?.last_sync || null,
      observation_count: parseInt(obsResult.rows[0]?.count || '0'),
      session_count: parseInt(sessResult.rows[0]?.count || '0'),
    };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/claude_mem_test bun test tests/services/server/PostgresManager.test.ts`
Expected: ALL PASS (or skipped if no Postgres available)

- [ ] **Step 6: Commit**

```bash
git add src/services/server/ tests/services/server/PostgresManager.test.ts
git commit -m "feat: implement PostgresManager with migrations, agents, observations, and full-text search"
```

---

## Task 8: Implement Server HTTP Routes

**Files:**
- Create: `src/services/server/http/routes/SyncRoutes.ts`
- Create: `src/services/server/http/routes/AgentRoutes.ts`
- Create: `src/services/server/http/routes/TeamSearchRoutes.ts`
- Test: `tests/services/server/routes/SyncRoutes.test.ts`
- Test: `tests/services/server/routes/AgentRoutes.test.ts`
- Test: `tests/services/server/routes/TeamSearchRoutes.test.ts`

- [ ] **Step 1: Write failing tests for SyncRoutes**

Create `tests/services/server/routes/SyncRoutes.test.ts`. Use the existing `BaseRouteHandler` pattern from `src/services/worker/http/routes/`. The test should:

1. Create a mock PostgresManager (or use a real test DB)
2. Create an Express app with the route handler registered
3. Test POST `/api/sync/push` with valid payload returns accepted/duplicates counts
4. Test POST `/api/sync/push` with empty payload returns 0 accepted
5. Test GET `/api/sync/status` returns agent's sync status
6. Test requests without auth header return 401

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import express from 'express';
import { SyncRoutes } from '../../../../src/services/server/http/routes/SyncRoutes.js';
import { PostgresManager } from '../../../../src/services/server/PostgresManager.js';
import { createApiKeyAuth } from '../../../../src/services/server/auth/ApiKeyAuth.js';
import { generateApiKey, hashApiKey } from '../../../../src/services/server/auth/key-generator.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const describeWithDb = TEST_DB_URL ? describe : describe.skip;

describeWithDb('SyncRoutes', () => {
  let app: express.Application;
  let pg: PostgresManager;
  let apiKey: string;
  let agentId: string;

  beforeAll(async () => {
    pg = new PostgresManager(TEST_DB_URL!);
    await pg.connect();
    await pg.runMigrations();

    // Create test agent
    apiKey = generateApiKey();
    const hash = await hashApiKey(apiKey);
    const agent = await pg.createAgent('SyncTestAgent', hash);
    agentId = agent.id;

    // Set up Express app with auth + sync routes
    app = express();
    app.use(express.json());
    app.use('/api', createApiKeyAuth(() => pg.getActiveAgents()));
    
    const syncRoutes = new SyncRoutes(pg);
    syncRoutes.setupRoutes(app);
  });

  afterAll(async () => {
    await pg.query('DELETE FROM observations');
    await pg.query('DELETE FROM sessions');
    await pg.query('DELETE FROM agents');
    await pg.close();
  });

  it('should accept observation push', async () => {
    const res = await fetch('http://localhost:0/api/sync/push', {
      // This won't work with fetch — use supertest or start the server
      // Adjust test to use supertest or app.listen() on a random port
    });
    // ... test implementation depends on test HTTP client choice
  });
});
```

**Note to implementer**: The project may or may not use `supertest`. Check `package.json` devDependencies. If not present, either:
- Add `supertest` as a dev dependency, or
- Start the Express app on a random port in `beforeAll` and use `fetch`

The second approach is simpler and doesn't add dependencies.

- [ ] **Step 2: Implement SyncRoutes**

Create `src/services/server/http/routes/SyncRoutes.ts`:

```typescript
import type { Request, Response, Application } from 'express';
import type { PostgresManager } from '../../PostgresManager.js';

export class SyncRoutes {
  constructor(private pg: PostgresManager) {}

  setupRoutes(app: Application): void {
    app.post('/api/sync/push', this.handlePush.bind(this));
    app.get('/api/sync/status', this.handleStatus.bind(this));
  }

  private async handlePush(req: Request, res: Response): Promise<void> {
    try {
      const agent = (req as any).agent;
      if (!agent) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const { observations = [], sessions = [], summaries = [] } = req.body;
      let accepted = 0;
      let duplicates = 0;
      const errors: string[] = [];

      // Insert observations
      for (const obs of observations) {
        try {
          const result = await this.pg.insertObservation({
            ...obs,
            agent_id: agent.id,
          });
          if (result.inserted) accepted++;
          else duplicates++;
        } catch (err: any) {
          errors.push(`observation ${obs.local_id}: ${err.message}`);
        }
      }

      // Insert sessions
      for (const session of sessions) {
        try {
          await this.pg.insertSession({
            ...session,
            agent_id: agent.id,
          });
          accepted++;
        } catch (err: any) {
          errors.push(`session ${session.local_session_id}: ${err.message}`);
        }
      }

      // Insert summaries
      for (const summary of summaries) {
        try {
          await this.pg.insertSummary({
            ...summary,
            agent_id: agent.id,
          });
          accepted++;
        } catch (err: any) {
          errors.push(`summary ${summary.local_summary_id}: ${err.message}`);
        }
      }

      res.json({ accepted, duplicates, errors });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  private async handleStatus(req: Request, res: Response): Promise<void> {
    try {
      const agent = (req as any).agent;
      if (!agent) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const status = await this.pg.getAgentSyncStatus(agent.id);
      res.json({
        agent_name: agent.name,
        ...status,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
```

- [ ] **Step 3: Implement AgentRoutes**

Create `src/services/server/http/routes/AgentRoutes.ts`:

```typescript
import type { Request, Response, Application } from 'express';
import type { PostgresManager } from '../../PostgresManager.js';
import { generateApiKey, hashApiKey } from '../../auth/key-generator.js';

export class AgentRoutes {
  constructor(private pg: PostgresManager) {}

  setupRoutes(app: Application): void {
    app.get('/api/agents', this.handleList.bind(this));
    app.post('/api/agents', this.handleCreate.bind(this));
    app.post('/api/agents/:name/revoke', this.handleRevoke.bind(this));
  }

  private async handleList(req: Request, res: Response): Promise<void> {
    try {
      const agents = await this.pg.getActiveAgents();
      res.json({
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          status: a.status,
          created_at: a.created_at,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  private async handleCreate(req: Request, res: Response): Promise<void> {
    try {
      const { name } = req.body;
      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'name is required' });
        return;
      }

      const apiKey = generateApiKey();
      const hash = await hashApiKey(apiKey);

      const agent = await this.pg.createAgent(name.trim(), hash);

      // Return the API key ONCE — it cannot be retrieved again
      res.status(201).json({
        id: agent.id,
        name: agent.name,
        api_key: apiKey,
        message: 'Save this API key — it cannot be retrieved again.',
      });
    } catch (error: any) {
      if (error.code === '23505') {
        res.status(409).json({ error: `Agent "${req.body.name}" already exists` });
        return;
      }
      res.status(500).json({ error: error.message });
    }
  }

  private async handleRevoke(req: Request, res: Response): Promise<void> {
    try {
      const { name } = req.params;
      const agent = await this.pg.getAgentByName(name);
      if (!agent) {
        res.status(404).json({ error: `Agent "${name}" not found` });
        return;
      }

      await this.pg.revokeAgent(name);
      res.json({ message: `Agent "${name}" revoked` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
```

- [ ] **Step 4: Implement TeamSearchRoutes**

Create `src/services/server/http/routes/TeamSearchRoutes.ts`:

```typescript
import type { Request, Response, Application } from 'express';
import type { PostgresManager } from '../../PostgresManager.js';

export class TeamSearchRoutes {
  constructor(private pg: PostgresManager) {}

  setupRoutes(app: Application): void {
    app.get('/api/search', this.handleSearch.bind(this));
    app.get('/api/timeline', this.handleTimeline.bind(this));
  }

  private async handleSearch(req: Request, res: Response): Promise<void> {
    try {
      const query = (req.query.query as string) || '';
      const limit = parseInt((req.query.limit as string) || '20');
      const offset = parseInt((req.query.offset as string) || '0');
      const project = req.query.project as string | undefined;
      const type = req.query.type as string | undefined;
      const agent = req.query.agent as string | undefined;

      const results = await this.pg.searchObservations(query, {
        limit, offset, project, type, agent,
      });

      res.json({ observations: results, count: results.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  private async handleTimeline(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt((req.query.limit as string) || '50');
      const offset = parseInt((req.query.offset as string) || '0');
      const project = req.query.project as string | undefined;
      const agent = req.query.agent as string | undefined;

      const results = await this.pg.getTimeline({
        limit, offset, project, agent,
      });

      res.json({ timeline: results, count: results.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
```

- [ ] **Step 5: Run all route tests**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/claude_mem_test bun test tests/services/server/routes/`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/server/http/ tests/services/server/routes/
git commit -m "feat: implement server HTTP routes for sync, agents, and team search"
```

---

## Task 9: Implement ServerService (Central Server Entry Point)

**Files:**
- Create: `src/services/server/ServerService.ts`
- Test: `tests/services/server/ServerService.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/services/server/ServerService.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { ServerService } from '../../../src/services/server/ServerService.js';

describe('ServerService', () => {
  it('should be instantiable with config', () => {
    const server = new ServerService({
      port: 8888,
      databaseUrl: 'postgres://localhost:5432/claude_mem_test',
    });
    expect(server).toBeDefined();
  });
});
```

- [ ] **Step 2: Implement ServerService**

Create `src/services/server/ServerService.ts`. Follow the pattern from `src/services/worker-service.ts` but simpler — no hooks, no session management, no SDK agents:

```typescript
import express from 'express';
import { PostgresManager } from './PostgresManager.js';
import { createApiKeyAuth } from './auth/ApiKeyAuth.js';
import { SyncRoutes } from './http/routes/SyncRoutes.js';
import { AgentRoutes } from './http/routes/AgentRoutes.js';
import { TeamSearchRoutes } from './http/routes/TeamSearchRoutes.js';

export interface ServerConfig {
  port: number;
  databaseUrl: string;
}

export class ServerService {
  private app: express.Application;
  private pg: PostgresManager;
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
    this.app = express();
    this.pg = new PostgresManager(config.databaseUrl);
  }

  async start(): Promise<void> {
    // Connect to Postgres
    await this.pg.connect();
    await this.pg.runMigrations();

    // Middleware
    this.app.use(express.json({ limit: '10mb' }));

    // Health check (no auth)
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', version: '1.0.0' });
    });

    // Auth middleware for /api/* routes
    const authMiddleware = createApiKeyAuth(() => this.pg.getActiveAgents());
    this.app.use('/api/sync', authMiddleware);
    this.app.use('/api/search', authMiddleware);
    this.app.use('/api/timeline', authMiddleware);
    // Agent routes: POST (create) and POST revoke need admin access.
    // For v1, agent management is CLI-only, so no auth on /api/agents.
    // The CLI calls these endpoints directly on the server machine.

    // Register routes
    new SyncRoutes(this.pg).setupRoutes(this.app);
    new AgentRoutes(this.pg).setupRoutes(this.app);
    new TeamSearchRoutes(this.pg).setupRoutes(this.app);

    // Start listening
    return new Promise((resolve) => {
      this.app.listen(this.config.port, () => {
        console.log(`Engram sync server listening on port ${this.config.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await this.pg.close();
  }

  // Expose for CLI commands that need direct DB access
  getPostgresManager(): PostgresManager {
    return this.pg;
  }
}
```

- [ ] **Step 3: Run test**

Run: `bun test tests/services/server/ServerService.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/services/server/ServerService.ts tests/services/server/ServerService.test.ts
git commit -m "feat: implement ServerService central server entry point"
```

---

## Task 10: Add CLI Commands (engram server + engram sync)

**Files:**
- Create: `src/npx-cli/commands/server.ts`
- Create: `src/npx-cli/commands/sync.ts`
- Modify: `src/npx-cli/index.ts`
- Modify: `package.json` (add `engram` bin alias)

- [ ] **Step 1: Implement server CLI commands**

Create `src/npx-cli/commands/server.ts`:

```typescript
import { ServerService } from '../../services/server/ServerService.js';
import { generateApiKey, hashApiKey } from '../../services/server/auth/key-generator.js';
import { PostgresManager } from '../../services/server/PostgresManager.js';

export async function runServerCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'start': {
      const port = parseInt(getFlag(args, '--port') || '8888');
      const databaseUrl = getFlag(args, '--database-url') || process.env.DATABASE_URL;

      if (!databaseUrl) {
        console.error('Error: --database-url or DATABASE_URL env var is required');
        process.exit(1);
      }

      const server = new ServerService({ port, databaseUrl });
      await server.start();
      
      // Keep process alive
      process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        await server.stop();
        process.exit(0);
      });
      process.on('SIGTERM', async () => {
        await server.stop();
        process.exit(0);
      });
      break;
    }

    case 'create-agent': {
      const name = getFlag(args, '--name');
      const databaseUrl = getFlag(args, '--database-url') || process.env.DATABASE_URL;

      if (!name) {
        console.error('Error: --name is required');
        process.exit(1);
      }
      if (!databaseUrl) {
        console.error('Error: --database-url or DATABASE_URL env var is required');
        process.exit(1);
      }

      const pg = new PostgresManager(databaseUrl);
      await pg.connect();
      await pg.runMigrations();

      const apiKey = generateApiKey();
      const hash = await hashApiKey(apiKey);

      try {
        const agent = await pg.createAgent(name, hash);
        console.log(`\nAgent created: ${agent.name}`);
        console.log(`API Key: ${apiKey}`);
        console.log(`\nSave this key — it cannot be retrieved again.`);
        console.log(`\nAdd to ~/.claude-mem/settings.json:`);
        console.log(JSON.stringify({
          CLAUDE_MEM_SYNC_ENABLED: true,
          CLAUDE_MEM_SYNC_SERVER_URL: 'http://your-server:8888',
          CLAUDE_MEM_SYNC_API_KEY: apiKey,
          CLAUDE_MEM_SYNC_AGENT_NAME: name,
        }, null, 2));
      } catch (error: any) {
        if (error.code === '23505') {
          console.error(`Error: Agent "${name}" already exists`);
        } else {
          console.error(`Error: ${error.message}`);
        }
        process.exit(1);
      } finally {
        await pg.close();
      }
      break;
    }

    case 'list-agents': {
      const databaseUrl = getFlag(args, '--database-url') || process.env.DATABASE_URL;
      if (!databaseUrl) {
        console.error('Error: --database-url or DATABASE_URL env var is required');
        process.exit(1);
      }

      const pg = new PostgresManager(databaseUrl);
      await pg.connect();

      const agents = await pg.getActiveAgents();
      if (agents.length === 0) {
        console.log('No active agents');
      } else {
        console.log(`\nActive agents (${agents.length}):\n`);
        for (const agent of agents) {
          console.log(`  ${agent.name} (created ${agent.created_at})`);
        }
      }

      await pg.close();
      break;
    }

    case 'revoke-agent': {
      const name = getFlag(args, '--name');
      const databaseUrl = getFlag(args, '--database-url') || process.env.DATABASE_URL;

      if (!name) {
        console.error('Error: --name is required');
        process.exit(1);
      }
      if (!databaseUrl) {
        console.error('Error: --database-url or DATABASE_URL env var is required');
        process.exit(1);
      }

      const pg = new PostgresManager(databaseUrl);
      await pg.connect();

      const agent = await pg.getAgentByName(name);
      if (!agent) {
        console.error(`Error: Agent "${name}" not found`);
        process.exit(1);
      }

      await pg.revokeAgent(name);
      console.log(`Agent "${name}" revoked`);

      await pg.close();
      break;
    }

    default:
      console.log(`Usage: engram server <command>

Commands:
  start              Start the sync server
    --port           Port (default: 8888)
    --database-url   Postgres connection string

  create-agent       Register a new agent
    --name           Agent display name

  list-agents        List all active agents

  revoke-agent       Revoke an agent's access
    --name           Agent name to revoke
`);
  }
}

function getFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}
```

- [ ] **Step 2: Implement sync CLI commands**

Create `src/npx-cli/commands/sync.ts`:

```typescript
import { SyncQueue } from '../../services/sync/SyncQueue.js';
import { SyncClient } from '../../services/sync/SyncClient.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { SETTINGS_PATH, DB_PATH } from '../../shared/paths.js';
import { Database } from 'bun:sqlite';

export async function runSyncCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  // Load settings
  const settings = SettingsDefaultsManager.loadFromFile(SETTINGS_PATH);

  switch (subcommand) {
    case 'status': {
      if (!settings.CLAUDE_MEM_SYNC_ENABLED) {
        console.log('Sync: disabled');
        console.log('Enable in ~/.claude-mem/settings.json: CLAUDE_MEM_SYNC_ENABLED = true');
        return;
      }

      const db = new Database(DB_PATH);
      const queue = new SyncQueue(db);
      const status = queue.getStatus();
      db.close();

      console.log(`\nSync Status`);
      console.log(`  Server:  ${settings.CLAUDE_MEM_SYNC_SERVER_URL}`);
      console.log(`  Agent:   ${settings.CLAUDE_MEM_SYNC_AGENT_NAME}`);
      console.log(`  Pending: ${status.pending}`);
      console.log(`  Synced:  ${status.synced}`);
      console.log(`  Failed:  ${status.failed}`);

      // Try to get remote status
      if (settings.CLAUDE_MEM_SYNC_SERVER_URL && settings.CLAUDE_MEM_SYNC_API_KEY) {
        try {
          const client = new SyncClient({
            serverUrl: settings.CLAUDE_MEM_SYNC_SERVER_URL,
            apiKey: settings.CLAUDE_MEM_SYNC_API_KEY,
            agentName: settings.CLAUDE_MEM_SYNC_AGENT_NAME,
            timeoutMs: settings.CLAUDE_MEM_SYNC_TIMEOUT_MS,
          });
          const remoteStatus = await client.getStatus();
          console.log(`\nServer:`);
          console.log(`  Last sync:    ${remoteStatus.last_sync_at || 'never'}`);
          console.log(`  Observations: ${remoteStatus.observation_count}`);
          console.log(`  Sessions:     ${remoteStatus.session_count}`);
        } catch (error: any) {
          console.log(`\nServer: unreachable (${error.message})`);
        }
      }
      break;
    }

    case 'retry': {
      const db = new Database(DB_PATH);
      const queue = new SyncQueue(db);
      const retried = queue.retryFailed();
      db.close();

      console.log(`${retried} failed items reset to pending`);
      break;
    }

    case 'pause': {
      // Write a pause flag file that SyncWorker checks
      const { writeFileSync } = await import('fs');
      const { join } = await import('path');
      // Check paths.ts for the data directory constant
      writeFileSync(join(DB_PATH, '..', '.sync-paused'), '', 'utf-8');
      console.log('Sync paused. Run "engram sync resume" to resume.');
      break;
    }

    case 'resume': {
      const { unlinkSync, existsSync } = await import('fs');
      const { join } = await import('path');
      const pauseFile = join(DB_PATH, '..', '.sync-paused');
      if (existsSync(pauseFile)) {
        unlinkSync(pauseFile);
      }
      console.log('Sync resumed.');
      break;
    }

    default:
      console.log(`Usage: engram sync <command>

Commands:
  status    Show sync state, queue counts, server connection
  retry     Reset all failed items to pending for retry
  pause     Pause sync (queue still fills, stops draining)
  resume    Resume sync draining
`);
  }
}
```

- [ ] **Step 3: Add commands to CLI entry point**

In `src/npx-cli/index.ts`, add to the switch statement (around line 142, after the last existing case):

```typescript
case 'server': {
  const { runServerCommand } = await import('./commands/server.js');
  await runServerCommand(args.slice(1));
  break;
}

case 'sync': {
  const { runSyncCommand } = await import('./commands/sync.js');
  await runSyncCommand(args.slice(1));
  break;
}
```

- [ ] **Step 4: Add engram bin entry to package.json**

In `package.json`, update the `bin` section:

```json
"bin": {
  "claude-mem": "./dist/npx-cli/index.js",
  "engram": "./dist/npx-cli/index.js"
},
```

- [ ] **Step 5: Add Postgres dependency**

**Preferred**: Use `postgres` (postgres.js) which is Bun-native and has no native bindings:
Run: `npm install postgres`

If `postgres` doesn't fit the codebase patterns, fall back to `pg` (may need native binding workarounds on Bun):
Run: `npm install pg && npm install -D @types/pg`

**Note**: If you use `postgres` instead of `pg`, update all imports in `PostgresManager.ts` from `import pg from 'pg'` to `import postgres from 'postgres'` and adjust the Pool/query API accordingly. The `postgres` API is simpler: `const sql = postgres(url); const rows = await sql\`SELECT ...\`;`

- [ ] **Step 6: Commit**

```bash
git add src/npx-cli/ package.json package-lock.json
git commit -m "feat: add engram server and engram sync CLI commands"
```

---

## Task 11: Wire SyncWorker into WorkerService

**Files:**
- Modify: `src/services/worker-service.ts`
- Modify: `src/services/sqlite/SessionStore.ts` (add getObservationById, getSessionById, getSummaryById if missing)

- [ ] **Step 1: Add lookup methods to SessionStore if needed**

Check if `SessionStore` already has `getObservationById`, `getSessionById`, `getSummaryById`. If not, add them:

```typescript
getObservationById(id: number): any {
  return this.db.prepare('SELECT * FROM observations WHERE id = ?').get(id);
}

getSessionById(id: number): any {
  return this.db.prepare('SELECT * FROM sdk_sessions WHERE id = ?').get(id);
}

getSummaryById(id: number): any {
  return this.db.prepare('SELECT * FROM session_summaries WHERE id = ?').get(id);
}
```

- [ ] **Step 2: Wire SyncWorker into worker-service.ts**

In `src/services/worker-service.ts`, in the `initializeBackground()` method (around line 345+), after the database is initialized and search is set up:

```typescript
// After dbManager.initialize() and SearchRoutes registration:

// Initialize sync if enabled
const syncEnabled = SettingsDefaultsManager.getBool('CLAUDE_MEM_SYNC_ENABLED');
if (syncEnabled) {
  const { SyncQueue } = await import('./sync/SyncQueue.js');
  const { SyncWorker } = await import('./sync/SyncWorker.js');
  
  const syncQueue = new SyncQueue(this.dbManager.getDatabase());
  this.syncWorker = new SyncWorker({
    enabled: true,
    queue: syncQueue,
    sessionStore: this.dbManager.getSessionStore(),
    serverUrl: SettingsDefaultsManager.get('CLAUDE_MEM_SYNC_SERVER_URL'),
    apiKey: SettingsDefaultsManager.get('CLAUDE_MEM_SYNC_API_KEY'),
    agentName: SettingsDefaultsManager.get('CLAUDE_MEM_SYNC_AGENT_NAME'),
    intervalMs: SettingsDefaultsManager.getInt('CLAUDE_MEM_SYNC_INTERVAL_MS'),
    timeoutMs: SettingsDefaultsManager.getInt('CLAUDE_MEM_SYNC_TIMEOUT_MS'),
    maxRetries: SettingsDefaultsManager.getInt('CLAUDE_MEM_SYNC_MAX_RETRIES'),
    batchSize: 100,
  });
  this.syncWorker.start();
  this.syncQueue = syncQueue; // Store reference for enqueueing
}
```

Add class properties:

```typescript
private syncWorker?: SyncWorker;
private syncQueue?: SyncQueue;
```

- [ ] **Step 3: Enqueue observations after storage**

Find where observations are stored in the worker (likely in `SessionManager` or the route handler that calls `SessionStore.storeObservation`). After the observation is stored and its `id` is returned, add:

```typescript
// After storing observation:
if (this.syncQueue) {
  this.syncQueue.enqueue('observation', observationId);
}
```

Similarly for sessions and summaries. Search for `storeObservation`, `createSDKSession`, and summary storage calls. The `syncQueue` reference needs to be passed down to wherever these store calls happen — either via constructor injection or by adding it to the WorkerService and passing to SessionManager.

**Important**: Read the actual code flow to find the right injection point. The observation storage likely happens in `SessionManager.ts` or via the SDKAgent callback. The syncQueue needs to be accessible there.

- [ ] **Step 4: Stop SyncWorker on shutdown**

In the shutdown handler (find `registerSignalHandlers` or graceful shutdown code):

```typescript
if (this.syncWorker) {
  this.syncWorker.stop();
}
```

- [ ] **Step 5: Test manually**

1. Set `CLAUDE_MEM_SYNC_ENABLED: true` in `~/.claude-mem/settings.json`
2. Start the worker: `npm run worker:start`
3. Check logs for sync initialization
4. Run `engram sync status` to verify queue is working

- [ ] **Step 6: Commit**

```bash
git add src/services/worker-service.ts src/services/sqlite/SessionStore.ts
git commit -m "feat: wire SyncWorker into WorkerService for automatic observation sync"
```

---

## Task 12: Integrate Team Search into SearchManager

**Files:**
- Modify: `src/services/worker/SearchManager.ts`
- Test: `tests/services/worker/SearchManager-team.test.ts` (new file)

**Architecture note**: `SearchManager` (line 35) has a 5-arg constructor:
```typescript
constructor(
  private sessionSearch: SessionSearch,
  private sessionStore: SessionStore,
  private chromaSync: ChromaSync | null,
  private formatter: FormattingService,
  private timelineService: TimelineService
)
```
It wraps these in a `SearchOrchestrator` (line 47). Do NOT change the constructor signature — that would break all existing call sites. Instead, add a setter method for the `SyncClient` and merge team results AFTER the orchestrator returns local results.

- [ ] **Step 1: Write failing test for team search integration**

Create `tests/services/worker/SearchManager-team.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'bun:test';
import { SearchManager } from '../../../src/services/worker/SearchManager.js';
import type { SyncClient } from '../../../src/services/sync/SyncClient.js';

// We need to test the merge logic without a full SearchManager setup.
// Create a minimal mock that tests the team merge behavior.

describe('SearchManager - Team Search Merge', () => {
  it('should have setSyncClient method', () => {
    // Verify the method exists on the class prototype
    expect(typeof SearchManager.prototype.setSyncClient).toBe('function');
  });
});

// Test the merge logic in isolation
describe('Team result merging', () => {
  it('should deduplicate by content_hash, local wins', () => {
    const localResults = [
      { id: 1, content_hash: 'hash_a', title: 'Local obs', created_at_epoch: 1000 },
      { id: 2, content_hash: 'hash_b', title: 'Local only', created_at_epoch: 900 },
    ];
    const teamResults = [
      { id: 99, content_hash: 'hash_a', agent_name: 'TeamMate', source: 'team', title: 'Dupe', created_at_epoch: 950 },
      { id: 100, content_hash: 'hash_c', agent_name: 'TeamMate', source: 'team', title: 'Team only', created_at_epoch: 800 },
    ];

    // Merge logic: dedup by content_hash, local wins
    const localHashes = new Set(localResults.map(r => r.content_hash).filter(Boolean));
    const teamFiltered = teamResults.filter(obs => !localHashes.has(obs.content_hash));
    const attributed = localResults.map(r => ({ ...r, source: 'local' as const, agent_name: 'Me' }));
    const combined = [...attributed, ...teamFiltered];
    combined.sort((a, b) => (b.created_at_epoch || 0) - (a.created_at_epoch || 0));

    expect(combined).toHaveLength(3); // hash_a (local), hash_b (local), hash_c (team)
    expect(combined[0].title).toBe('Local obs'); // highest epoch
    expect(combined[2].agent_name).toBe('TeamMate'); // team result last
  });

  it('should keep earliest among remote duplicates', () => {
    const teamResults = [
      { id: 101, content_hash: 'hash_d', agent_name: 'Alice', source: 'team', created_at_epoch: 500 },
      { id: 102, content_hash: 'hash_d', agent_name: 'Bob', source: 'team', created_at_epoch: 600 },
    ];

    // Among remote dupes, keep earliest
    const seen = new Map<string, any>();
    for (const obs of teamResults) {
      const existing = seen.get(obs.content_hash);
      if (!existing || obs.created_at_epoch < existing.created_at_epoch) {
        seen.set(obs.content_hash, obs);
      }
    }
    const deduped = Array.from(seen.values());

    expect(deduped).toHaveLength(1);
    expect(deduped[0].agent_name).toBe('Alice'); // earliest
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/services/worker/SearchManager-team.test.ts`
Expected: FAIL — `setSyncClient` does not exist on `SearchManager`

- [ ] **Step 3: Add SyncClient integration to SearchManager**

In `src/services/worker/SearchManager.ts`:

1. Add import at the top:
```typescript
import { SyncClient } from '../sync/SyncClient.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
```

2. Add class property after line 37 (`private timelineBuilder: TimelineBuilder;`):
```typescript
private syncClient: SyncClient | null = null;
```

3. Add setter method (after the constructor, around line 55):
```typescript
setSyncClient(client: SyncClient | null): void {
  this.syncClient = client;
}
```

4. In the `search()` method, find where the final results are returned (the `return` statement with the results array). BEFORE that return, add the team merge:

```typescript
// Merge team results if sync is enabled
if (this.syncClient) {
  try {
    const teamResponse = await this.syncClient.searchTeam(query, {
      limit: String(limit),
      ...(project ? { project } : {}),
      ...(type ? { type } : {}),
    });

    // Deduplicate: local wins by content_hash
    const localHashes = new Set(
      localResults.map((r: any) => r.content_hash).filter(Boolean)
    );

    // Among remote duplicates, keep earliest
    const remoteSeen = new Map<string, any>();
    for (const obs of teamResponse.observations) {
      if (localHashes.has((obs as any).content_hash)) continue;
      const existing = remoteSeen.get((obs as any).content_hash);
      if (!existing || obs.created_at_epoch < existing.created_at_epoch) {
        remoteSeen.set((obs as any).content_hash, obs);
      }
    }
    const teamFiltered = Array.from(remoteSeen.values());

    // Attribute local results
    const agentName = SettingsDefaultsManager.get('CLAUDE_MEM_SYNC_AGENT_NAME') || 'local';
    const attributed = localResults.map((r: any) => ({
      ...r,
      source: 'local',
      agent_name: agentName,
    }));

    // Combine and sort by recency
    const combined = [...attributed, ...teamFiltered];
    combined.sort((a: any, b: any) => (b.created_at_epoch || 0) - (a.created_at_epoch || 0));

    // Replace localResults with combined
    localResults = combined.slice(0, limit);
  } catch (error) {
    // Server timeout or error — silently fall through to local-only results
  }
}
```

**Important**: The exact insertion point depends on the `search()` method's structure. Read the method (~lines 126-392) to find where `localResults` is assembled before the final return. The merge block goes right before the return statement. The variable name `localResults` is a placeholder — use whatever variable the method actually populates.

5. Apply the same pattern to the `timeline()` method (~lines 397-670): after local timeline data is built, merge team timeline if `this.syncClient` exists.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/services/worker/SearchManager-team.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/worker/SearchManager.ts tests/services/worker/SearchManager-team.test.ts
git commit -m "feat: merge team search results into local SearchManager queries"
```

---

## Task 13: Update MCP Server Response Format

**Files:**
- Modify: `src/servers/mcp-server.ts`

- [ ] **Step 1: Add agent_name and source fields to search responses**

The MCP server is a thin proxy to the worker API. Since the SearchManager now returns `agent_name` and `source` fields in its results (from Task 12), the MCP server should already pass them through. Verify this by:

1. Reading `src/servers/mcp-server.ts`
2. Confirm that the `callWorkerAPI` response is passed through as-is to the MCP tool result
3. If there's any response transformation that strips unknown fields, update it to preserve `agent_name` and `source`

The MCP tool definitions (`search`, `smart_search`, `timeline`, `get_observations`) don't need new input parameters — team results are automatic when sync is enabled. However, add the optional `agent` filter parameter:

In the `search` tool definition's `inputSchema.properties`, add:

```typescript
agent: {
  type: 'string',
  description: 'Filter by agent name (team member)',
}
```

- [ ] **Step 2: Test by running MCP server**

Start the worker and MCP server, verify search results include team attribution fields.

- [ ] **Step 3: Commit**

```bash
git add src/servers/mcp-server.ts
git commit -m "feat: add agent filter parameter to MCP search tools"
```

---

## Task 14: Add Docker Deployment Files

**Files:**
- Create: `docker/docker-compose.yml`
- Create: `docker/Dockerfile.server`

- [ ] **Step 1: Create Dockerfile.server**

Create `docker/Dockerfile.server`:

```dockerfile
FROM oven/bun:1 AS builder

WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM oven/bun:1-slim

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src/services/server/migrations ./src/services/server/migrations

EXPOSE 8888

CMD ["bun", "dist/npx-cli/index.js", "server", "start", "--port", "8888"]
```

- [ ] **Step 2: Create docker-compose.yml**

Create `docker/docker-compose.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: claude_mem
      POSTGRES_USER: claude_mem
      POSTGRES_PASSWORD: changeme
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U claude_mem"]
      interval: 5s
      timeout: 5s
      retries: 5

  engram-server:
    build:
      context: ..
      dockerfile: docker/Dockerfile.server
    environment:
      DATABASE_URL: postgres://claude_mem:changeme@postgres:5432/claude_mem
    ports:
      - "8888:8888"
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

volumes:
  pgdata:
```

- [ ] **Step 3: Test docker-compose**

Run: `cd docker && docker compose up -d`
Verify: `curl http://localhost:8888/health` returns `{"status":"ok"}`

- [ ] **Step 4: Commit**

```bash
git add docker/
git commit -m "feat: add Docker deployment files for engram sync server"
```

---

## Task 15: Integration Test (End-to-End Sync Flow)

**Files:**
- Create: `tests/integration/sync-e2e.test.ts`

- [ ] **Step 1: Write end-to-end integration test**

Create `tests/integration/sync-e2e.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../../src/services/sqlite/migrations/runner.js';
import { SyncQueue } from '../../src/services/sync/SyncQueue.js';
import { SyncClient } from '../../src/services/sync/SyncClient.js';
import { SyncWorker } from '../../src/services/sync/SyncWorker.js';
import { PostgresManager } from '../../src/services/server/PostgresManager.js';
import { ServerService } from '../../src/services/server/ServerService.js';
import { generateApiKey, hashApiKey } from '../../src/services/server/auth/key-generator.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const describeWithDb = TEST_DB_URL ? describe : describe.skip;

describeWithDb('End-to-End Sync Flow', () => {
  let server: ServerService;
  let localDb: Database;
  let apiKey: string;
  const SERVER_PORT = 19876; // Random high port for testing

  beforeAll(async () => {
    // Start central server
    server = new ServerService({ port: SERVER_PORT, databaseUrl: TEST_DB_URL! });
    await server.start();

    // Create agent
    apiKey = generateApiKey();
    const hash = await hashApiKey(apiKey);
    const pg = server.getPostgresManager();
    await pg.createAgent('E2EAgent', hash);

    // Set up local SQLite
    localDb = new Database(':memory:');
    const runner = new MigrationRunner(localDb);
    runner.runAllMigrations();

    // Simulate a local observation
    localDb.prepare(`
      INSERT INTO observations (memory_session_id, project, type, title, facts, narrative, concepts, files_read, files_modified, created_at, created_at_epoch, content_hash)
      VALUES ('session-1', 'test-project', 'discovery', 'E2E Test Discovery', '["fact1"]', 'Found something', '["testing"]', '[]', '[]', datetime('now'), ?, 'e2e_hash_001')
    `).run(Date.now());
  });

  afterAll(async () => {
    localDb.close();
    const pg = server.getPostgresManager();
    await pg.query('DELETE FROM observations');
    await pg.query('DELETE FROM agents');
    await server.stop();
  });

  it('should sync a local observation to the server and find it via team search', async () => {
    // 1. Enqueue the observation
    const queue = new SyncQueue(localDb);
    queue.enqueue('observation', 1); // ID 1 from the insert above

    // 2. Verify it's pending
    expect(queue.getStatus().pending).toBe(1);

    // 3. Create a SyncClient and push manually (simulate SyncWorker tick)
    const client = new SyncClient({
      serverUrl: `http://localhost:${SERVER_PORT}`,
      apiKey,
      agentName: 'E2EAgent',
      timeoutMs: 5000,
    });

    // Build payload manually (since we don't have SessionStore connected)
    const obs = localDb.prepare('SELECT * FROM observations WHERE id = 1').get() as any;
    const response = await client.push({
      observations: [{
        local_id: obs.id,
        content_hash: obs.content_hash,
        type: obs.type,
        title: obs.title,
        subtitle: obs.subtitle || null,
        facts: JSON.parse(obs.facts || '[]'),
        narrative: obs.narrative,
        concepts: JSON.parse(obs.concepts || '[]'),
        files_read: JSON.parse(obs.files_read || '[]'),
        files_modified: JSON.parse(obs.files_modified || '[]'),
        project: obs.project,
        created_at: obs.created_at,
        created_at_epoch: obs.created_at_epoch,
        prompt_number: obs.prompt_number || null,
        model_used: obs.model_used || null,
      }],
      sessions: [],
      summaries: [],
    });

    expect(response.accepted).toBe(1);
    expect(response.duplicates).toBe(0);

    // 4. Search via team endpoint
    const searchResult = await client.searchTeam('E2E Test Discovery');
    expect(searchResult.observations).toHaveLength(1);
    expect(searchResult.observations[0].agent_name).toBe('E2EAgent');
    expect(searchResult.observations[0].title).toBe('E2E Test Discovery');

    // 5. Push again — should be deduplicated
    const response2 = await client.push({
      observations: [{
        local_id: obs.id,
        content_hash: obs.content_hash,
        type: obs.type,
        title: obs.title,
        subtitle: null,
        facts: JSON.parse(obs.facts || '[]'),
        narrative: obs.narrative,
        concepts: JSON.parse(obs.concepts || '[]'),
        files_read: JSON.parse(obs.files_read || '[]'),
        files_modified: JSON.parse(obs.files_modified || '[]'),
        project: obs.project,
        created_at: obs.created_at,
        created_at_epoch: obs.created_at_epoch,
        prompt_number: null,
        model_used: null,
      }],
      sessions: [],
      summaries: [],
    });

    // Dedup: accepted 0, duplicates should be implicit (accepted stays at previous count)
    expect(response2.errors).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `TEST_DATABASE_URL=postgres://localhost:5432/claude_mem_test bun test tests/integration/sync-e2e.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/sync-e2e.test.ts
git commit -m "test: add end-to-end sync integration test"
```

---

## Dependency Order

```
Task 1 (Settings) ─────────────────────────────────────┐
Task 2 (Migration) ────────────────────────────────────┤
                                                        ├─→ Task 11 (Wire into Worker)
Task 3 (SyncQueue) ──── depends on Task 2 ────────────┤
Task 4 (SyncClient) ──────────────────────────────────┤
Task 5 (SyncWorker) ──── depends on Tasks 3, 4 ───────┤
                                                        │
Task 6 (Auth) ─────────────────────────────────────────┤
Task 7 (PostgresManager) ── depends on Task 6 ────────┤
Task 8 (Server Routes) ──── depends on Tasks 6, 7 ────┤
Task 9 (ServerService) ──── depends on Tasks 7, 8 ────┤── Task 10 (CLI)
                                                        │
Task 12 (Search Integration) ── depends on Tasks 4, 11 ┤
Task 13 (MCP Update) ──── depends on Task 12 ──────────┤
Task 14 (Docker) ──── depends on Task 9 ───────────────┤
Task 15 (E2E Test) ──── depends on ALL above ──────────┘
```

**Parallel tracks:**
- Track A (local sync): Tasks 1, 2, 3, 4, 5 (can run in parallel with Track B)
- Track B (server): Tasks 6, 7, 8, 9 (can run in parallel with Track A)
- Integration: Tasks 10, 11, 12, 13, 14, 15 (sequential, depends on both tracks)
