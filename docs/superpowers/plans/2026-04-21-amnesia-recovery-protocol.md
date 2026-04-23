# Amnesia Recovery Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Claude Code compacts context, Engram intercepts the PreCompact hook, generates a ≤500-token briefing, stores it in SQLite, and injects it at the next SessionStart so Claude resumes with working context.

**Architecture:** PreCompact hook → POST `/api/briefings/generate` (local worker) → `BriefingGenerator` (template + LLM) → `session_briefings` SQLite table. On next SessionStart, `context.ts` calls GET `/api/briefings/pending` (atomic mark-consumed), prepends the briefing to existing context output. Feature-flagged behind `CLAUDE_MEM_AMNESIA_RECOVERY_ENABLED`.

**Tech Stack:** Bun, TypeScript, bun:sqlite, `bun:test`, existing `workerHttpRequest` / `SettingsDefaultsManager` patterns. LLM injection via same `(prompt: string) => Promise<string>` closure used by `LearningExtractor`.

---

## ⚠️ Migration version note

The spec was written when migration v27 was current. Since then, migrations 28–31 were added (`addProvenanceColumns`, `addExtractionStatusColumns`, `widenSyncQueueForLearnings`, `addLastErrorColumn`). The `session_briefings` table must be **migration v32**.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/services/sqlite/migrations/runner.ts` | Modify | Add `createSessionBriefingsTable()` as migration v32 |
| `src/services/sqlite/Briefings.ts` | Create | CRUD: store, getPending, markConsumed, cleanup |
| `src/services/sqlite/__tests__/briefings.test.ts` | Create | Tests for Briefings.ts CRUD + atomicity |
| `src/services/sync/BriefingGenerator.ts` | Create | Hybrid template+LLM, injectable llm closure, token budget |
| `src/services/sync/__tests__/BriefingGenerator.test.ts` | Create | Tests for template, LLM call, fallback, token budget |
| `src/cli/handlers/pre-compact.ts` | Create | PreCompact hook: read transcript tail, POST briefings/generate, always exit 0 |
| `src/cli/handlers/index.ts` | Modify | Add `'pre-compact'` to `EventType` union + import handler |
| `src/cli/handlers/context.ts` | Modify | After fetching context, fetch GET `/api/briefings/pending`, prepend briefing |
| `src/services/worker-service.ts` | Modify | Add POST + GET routes, wire BriefingStore + BriefingGenerator, add cleanup + metrics |

---

## ⚠️ Task ordering constraint

**Task 7 (settings flag) MUST run before Tasks 4, 5, and 6.** Tasks 4–6 reference `settings.CLAUDE_MEM_AMNESIA_RECOVERY_ENABLED` which doesn't exist on `SettingsDefaults` until Task 7 adds it. TypeScript compilation will fail otherwise. Recommended order: 1 → 2 → 3 → **7** → 4 → 5 → 6.

---

## Task 1: Migration v32 — session_briefings table

**Files:**
- Modify: `src/services/sqlite/migrations/runner.ts` (after `addLastErrorColumn` at L1137)

- [ ] **Step 1: Write the failing test**

Create `src/services/sqlite/__tests__/briefings.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../migrations/runner.js';

describe('session_briefings migration', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    const runner = new MigrationRunner(db);
    runner.runAllMigrations();
  });

  afterEach(() => { db.close(); });

  test('creates session_briefings table with required columns', () => {
    const cols = db.query(`PRAGMA table_info(session_briefings)`).all() as any[];
    const names = cols.map(c => c.name);
    expect(names).toContain('id');
    expect(names).toContain('memory_session_id');
    expect(names).toContain('project');
    expect(names).toContain('briefing_text');
    expect(names).toContain('trigger');
    expect(names).toContain('consumed_at');
    expect(names).toContain('created_at');
  });

  test('trigger column defaults to pre_compact', () => {
    const cols = db.query(`PRAGMA table_info(session_briefings)`).all() as any[];
    const trigger = cols.find(c => c.name === 'trigger');
    expect(trigger?.dflt_value).toBe("'pre_compact'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/services/sqlite/__tests__/briefings.test.ts
```
Expected: FAIL — "no such table: session_briefings"

- [ ] **Step 3: Add migration method to runner.ts**

In `src/services/sqlite/migrations/runner.ts`, add after `addLastErrorColumn` (after L1154):

```typescript
private createSessionBriefingsTable(): void {
  // migration 32
  const VERSION = 32;
  if (this.getCurrentVersion() >= VERSION) return;

  this.db.run(`
    CREATE TABLE IF NOT EXISTS session_briefings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_session_id TEXT NOT NULL,
      project TEXT NOT NULL,
      briefing_text TEXT NOT NULL,
      trigger TEXT NOT NULL DEFAULT 'pre_compact',
      consumed_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  this.db.run(`CREATE INDEX IF NOT EXISTS idx_briefings_session_consumed
    ON session_briefings(memory_session_id, consumed_at)`);
  this.db.run(`INSERT OR REPLACE INTO schema_versions(version, applied_at)
    VALUES (${VERSION}, unixepoch())`);
}
```

In `runAllMigrations()`, add call at end of the list:
```typescript
this.createSessionBriefingsTable();
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test src/services/sqlite/__tests__/briefings.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/sqlite/migrations/runner.ts src/services/sqlite/__tests__/briefings.test.ts
git commit -m "feat(amnesia): add session_briefings table migration v32"
```

---

## Task 2: BriefingStore CRUD

**Files:**
- Create: `src/services/sqlite/Briefings.ts`
- Modify: `src/services/sqlite/__tests__/briefings.test.ts` (add new tests)

- [ ] **Step 1: Add CRUD tests to briefings.test.ts**

Append to the existing test file:

```typescript
import { BriefingStore } from '../Briefings.js';

describe('BriefingStore', () => {
  let db: Database;
  let store: BriefingStore;

  beforeEach(() => {
    db = new Database(':memory:');
    new MigrationRunner(db).runAllMigrations();
    store = new BriefingStore(db);
  });

  afterEach(() => { db.close(); });

  test('store() inserts a row and returns id', () => {
    const id = store.store({ memorySessionId: 'sess-1', project: '/my/proj', briefingText: 'Active task: fix bug' });
    expect(id).toBeGreaterThan(0);
  });

  test('getPendingAndConsume() returns latest unconsumed briefing and marks it consumed', () => {
    store.store({ memorySessionId: 'sess-1', project: '/my/proj', briefingText: 'first' });
    store.store({ memorySessionId: 'sess-1', project: '/my/proj', briefingText: 'second' });

    const briefing = store.getPendingAndConsume('/my/proj');
    expect(briefing?.briefingText).toBe('second'); // latest wins

    // second call returns null (already consumed)
    const again = store.getPendingAndConsume('/my/proj');
    expect(again).toBeNull();
  });

  test('getPendingAndConsume() returns null when no unconsumed briefing', () => {
    const result = store.getPendingAndConsume('/my/proj');
    expect(result).toBeNull();
  });

  test('cleanup() deletes unconsumed rows older than 7 days', () => {
    const sevenDaysAgoSec = Math.floor(Date.now() / 1000) - 7 * 24 * 3600 - 1;
    db.run(
      `INSERT INTO session_briefings (memory_session_id, project, briefing_text, created_at)
       VALUES ('sess-old', '/old', 'stale', ?)`,
      [sevenDaysAgoSec]
    );
    store.store({ memorySessionId: 'sess-new', project: '/new', briefingText: 'fresh' });

    const deleted = store.cleanup();
    expect(deleted).toBe(1);

    const remaining = db.query(`SELECT COUNT(*) as n FROM session_briefings`).get() as any;
    expect(remaining.n).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/services/sqlite/__tests__/briefings.test.ts
```
Expected: FAIL — "Cannot find module '../Briefings.js'"

- [ ] **Step 3: Create Briefings.ts**

Create `src/services/sqlite/Briefings.ts`:

```typescript
import type { Database } from 'bun:sqlite';

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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/services/sqlite/__tests__/briefings.test.ts
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/sqlite/Briefings.ts src/services/sqlite/__tests__/briefings.test.ts
git commit -m "feat(amnesia): add BriefingStore CRUD with atomic consume"
```

---

## Task 3: BriefingGenerator service

**Files:**
- Create: `src/services/sync/BriefingGenerator.ts`
- Create: `src/services/sync/__tests__/BriefingGenerator.test.ts`

The generator combines a deterministic template section (~300 tokens) with a short LLM-generated task summary (~150 tokens). Total ≤500 tokens. LLM failure falls back to template-only.

- [ ] **Step 1: Write failing tests**

Create `src/services/sync/__tests__/BriefingGenerator.test.ts`:

```typescript
import { describe, test, expect } from 'bun:test';
import { BriefingGenerator, type BriefingInput } from '../BriefingGenerator.js';

const baseInput: BriefingInput = {
  memorySessionId: 'sess-1',
  project: '/my/proj',
  transcriptTail: 'User: fix the login bug. Assistant: Found null check missing in auth.ts line 42.',
  recentFiles: ['src/auth.ts', 'src/login.ts'],
  recentDecisions: ['Use JWT for session tokens'],
  recentErrors: ['TypeError: Cannot read property of null at auth.ts:42'],
  openTodos: ['Fix null check in auth.ts'],
};

describe('BriefingGenerator', () => {
  test('generates briefing with template sections', async () => {
    const gen = new BriefingGenerator({ llm: async () => 'LLM summary: fixing auth null check' });
    const result = await gen.generate(baseInput);

    expect(result.text).toContain('src/auth.ts');
    expect(result.text).toContain('Fix null check');
    expect(result.text).toContain('JWT');
  });

  test('includes LLM summary when llm succeeds', async () => {
    const gen = new BriefingGenerator({ llm: async () => 'Active task: fixing login null check in auth.ts' });
    const result = await gen.generate(baseInput);

    expect(result.text).toContain('Active task: fixing login null check');
    expect(result.usedLlm).toBe(true);
  });

  test('falls back to template-only when LLM throws', async () => {
    const gen = new BriefingGenerator({ llm: async () => { throw new Error('LLM unavailable'); } });
    const result = await gen.generate(baseInput);

    expect(result.text).toContain('src/auth.ts');
    expect(result.usedLlm).toBe(false);
  });

  test('returns template-only when no llm provided', async () => {
    const gen = new BriefingGenerator({});
    const result = await gen.generate(baseInput);
    expect(result.text.length).toBeGreaterThan(20);
    expect(result.usedLlm).toBe(false);
  });

  test('total briefing fits within 500 token budget (~2000 chars)', async () => {
    const longInput: BriefingInput = {
      ...baseInput,
      recentFiles: Array(50).fill('src/very-long-file-name-that-takes-many-tokens.ts'),
      openTodos: Array(30).fill('Fix extremely verbose todo description that takes many tokens'),
    };
    const gen = new BriefingGenerator({ llm: async () => 'summary' });
    const result = await gen.generate(longInput);
    expect(result.text.length).toBeLessThanOrEqual(2000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/services/sync/__tests__/BriefingGenerator.test.ts
```
Expected: FAIL — "Cannot find module '../BriefingGenerator.js'"

- [ ] **Step 3: Implement BriefingGenerator.ts**

Create `src/services/sync/BriefingGenerator.ts`:

```typescript
export interface BriefingInput {
  memorySessionId: string;
  project: string;
  transcriptTail: string;         // last ~6000 chars of transcript
  recentFiles: string[];
  openTodos: string[];
  recentDecisions: string[];
  recentErrors: string[];
}

export interface BriefingGeneratorConfig {
  llm?: (prompt: string) => Promise<string>;
}

// Token budget: 500 tokens ≈ 2000 chars. Template gets 300 tokens (~1200 chars), LLM gets 150 tokens (~600 chars).
const TEMPLATE_BUDGET = 1200;
const LLM_BUDGET = 600;

function truncateList(items: string[], budget: number): string {
  const lines: string[] = [];
  let remaining = budget;
  for (const item of items) {
    const line = `- ${item}`;
    if (remaining - line.length - 1 < 0) break;
    lines.push(line);
    remaining -= line.length + 1;
  }
  return lines.join('\n');
}

function buildTemplate(input: BriefingInput): string {
  // Budget allocation: files=300, todos=300, decisions=300, errors=300 chars each
  const itemBudget = Math.floor(TEMPLATE_BUDGET / 4);
  const sections: string[] = ['## Context Recovery Briefing'];

  if (input.recentFiles.length > 0) {
    const content = truncateList(input.recentFiles, itemBudget - 20);
    sections.push(`**Recent files:**\n${content}`);
  }
  if (input.openTodos.length > 0) {
    const content = truncateList(input.openTodos, itemBudget - 20);
    sections.push(`**Open todos:**\n${content}`);
  }
  if (input.recentDecisions.length > 0) {
    const content = truncateList(input.recentDecisions, itemBudget - 20);
    sections.push(`**Recent decisions:**\n${content}`);
  }
  if (input.recentErrors.length > 0) {
    const content = truncateList(input.recentErrors, itemBudget - 20);
    sections.push(`**Recent errors:**\n${content}`);
  }

  return sections.join('\n\n');
}

function buildLlmPrompt(input: BriefingInput): string {
  const tail = input.transcriptTail.slice(-4000);
  return `Summarize the active task from this conversation tail in 1-2 sentences (max 120 tokens). Be specific about what was being worked on and what the immediate next step is.

Conversation tail:
${tail}

Active task summary:`;
}

export class BriefingGenerator {
  private llm?: (prompt: string) => Promise<string>;

  constructor(config: BriefingGeneratorConfig) {
    this.llm = config.llm;
  }

  async generate(input: BriefingInput): Promise<{ text: string; usedLlm: boolean }> {
    const template = buildTemplate(input);

    if (!this.llm) {
      return { text: template.slice(0, TEMPLATE_BUDGET), usedLlm: false };
    }

    let llmSummary = '';
    try {
      const raw = await this.llm(buildLlmPrompt(input));
      llmSummary = raw.trim().slice(0, LLM_BUDGET);
    } catch {
      // LLM failure: return template only, signal fallback
      return { text: template.slice(0, TEMPLATE_BUDGET), usedLlm: false };
    }

    const combined = `${template}\n\n**Active task:**\n${llmSummary}`;
    return { text: combined.slice(0, TEMPLATE_BUDGET + LLM_BUDGET), usedLlm: true };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/services/sync/__tests__/BriefingGenerator.test.ts
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/sync/BriefingGenerator.ts src/services/sync/__tests__/BriefingGenerator.test.ts
git commit -m "feat(amnesia): add BriefingGenerator with template+LLM hybrid"
```

---

## Task 4: Worker API routes

Add `POST /api/briefings/generate` and `GET /api/briefings/pending` to the local worker.

**Files:**
- Modify: `src/services/worker-service.ts`

The `registerRoutes()` method is at L315–362. The `initializeBackground()` method at L402–683 is where to instantiate BriefingGenerator (alongside LearningExtractor pattern at L147–176 `buildLearningLlmClosure`).

Note: No handler-level test file pattern exists for worker routes. Write integration-style unit tests by calling route handlers directly with mock request objects.

- [ ] **Step 1: Read registerRoutes and initializeBackground in worker-service.ts**

```bash
# Read the route registration block
```

Use `smart_outline` then read L315-420 of `src/services/worker-service.ts` to understand the Bun server request handler shape (pattern for `req.url`, JSON response, etc.) before adding routes.

- [ ] **Step 2: Add BriefingStore + BriefingGenerator initialization**

In `initializeBackground()` (L402–683), after the `LearningExtractor`/`SyncWorker` initialization block, add:

```typescript
// Amnesia Recovery: initialize BriefingStore and BriefingGenerator
import { BriefingStore } from './sqlite/Briefings.js';
import { BriefingGenerator } from './sync/BriefingGenerator.js';

// (Add these fields to the WorkerService class)
private briefingStore: BriefingStore | null = null;
private briefingGenerator: BriefingGenerator | null = null;
```

In `initializeBackground()`, wire them up after DB is ready:
```typescript
if (settings.CLAUDE_MEM_AMNESIA_RECOVERY_ENABLED === 'true') {
  this.briefingStore = new BriefingStore(db);
  const llmClosure = buildLearningLlmClosure(
    settings.CLAUDE_MEM_MODEL ?? 'claude-haiku-4-5-20251001',
    settings.CLAUDE_MEM_PROVIDER ?? 'anthropic',
    settings.CLAUDE_MEM_API_KEY
  );
  this.briefingGenerator = new BriefingGenerator({ llm: llmClosure });
}
```

- [ ] **Step 3: Add routes in registerRoutes()**

In `registerRoutes()` (L315–362), add two route handlers:

```typescript
// POST /api/briefings/generate
if (url.pathname === '/api/briefings/generate' && req.method === 'POST') {
  if (!this.briefingStore || !this.briefingGenerator) {
    return new Response(JSON.stringify({ error: 'amnesia recovery disabled' }), { status: 503 });
  }
  try {
    const body = await req.json() as {
      memorySessionId: string;
      project: string;
      transcriptTail: string;
      recentFiles?: string[];
      openTodos?: string[];
      recentDecisions?: string[];
      recentErrors?: string[];
    };
    const start = Date.now();
    const result = await this.briefingGenerator.generate({
      memorySessionId: body.memorySessionId,
      project: body.project,
      transcriptTail: body.transcriptTail,
      recentFiles: body.recentFiles ?? [],
      openTodos: body.openTodos ?? [],
      recentDecisions: body.recentDecisions ?? [],
      recentErrors: body.recentErrors ?? [],
    });
    const id = this.briefingStore.store({ memorySessionId: body.memorySessionId, project: body.project, briefingText: result.text });
    const latencyMs = Date.now() - start;
    logger.debug({ id, latencyMs }, 'briefings.generated');
    if (!result.usedLlm) logger.debug({ id }, 'briefings.llm_fallback');
    return new Response(JSON.stringify({ id, latencyMs }), { status: 201 });
  } catch (err) {
    logger.error({ err }, 'briefings.generate failed');
    return new Response(JSON.stringify({ error: 'generation failed' }), { status: 500 });
  }
}

// GET /api/briefings/pending?project=...
if (url.pathname === '/api/briefings/pending' && req.method === 'GET') {
  if (!this.briefingStore) {
    return new Response(JSON.stringify({ briefing: null }), { status: 200 });
  }
  const project = url.searchParams.get('project') ?? '';
  const row = this.briefingStore.getPendingAndConsume(project);
  if (row) {
    logger.debug({ id: row.id, project }, 'briefings.consumed');
  }
  return new Response(JSON.stringify({ briefing: row?.briefingText ?? null }), { status: 200 });
}
```

- [ ] **Step 4: Add cleanup call to existing worker cleanup job**

In `worker-service.ts`, find the periodic cleanup / stale session reap job (look for `reapStaleSessions` call or any `setInterval` with cleanup logic). Add:

```typescript
if (this.briefingStore) {
  const deleted = this.briefingStore.cleanup();
  if (deleted > 0) logger.debug({ deleted }, 'briefings.cleanup');
}
```

- [ ] **Step 5: Run full test suite to verify no regressions**

```bash
bun test
```
Expected: all existing tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/worker-service.ts src/services/sqlite/Briefings.ts src/services/sync/BriefingGenerator.ts
git commit -m "feat(amnesia): add worker routes for briefing generate + pending"
```

---

## Task 5: PreCompact hook handler

**Files:**
- Create: `src/cli/handlers/pre-compact.ts`
- Modify: `src/cli/handlers/index.ts`

No existing handler tests exist, but the PreCompact handler has critical safety behavior (always exit 0). Test via direct function call with mock `workerHttpRequest`.

- [ ] **Step 1: Write failing test for the handler's safety contract**

Create `src/cli/handlers/__tests__/pre-compact.test.ts`:

```typescript
import { describe, test, expect, mock } from 'bun:test';

// Test the handler's safety: must always return { exit: 0 }
describe('pre-compact handler', () => {
  test('returns exit 0 when feature flag is disabled', async () => {
    // Import handler lazily to avoid module-level side effects
    const { preCompactHandler } = await import('../pre-compact.js');
    const result = await preCompactHandler.execute({
      event: 'pre_compact',
      sessionId: 'sess-1',
      cwd: '/my/proj',
      platformSource: 'claude_code',
      hookEventType: 'PreCompact',
      payload: {},
    } as any);
    expect(result.exitCode).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/cli/handlers/__tests__/pre-compact.test.ts
```
Expected: FAIL — "Cannot find module '../pre-compact.js'"

- [ ] **Step 3: Create pre-compact.ts**

Create `src/cli/handlers/pre-compact.ts`:

```typescript
import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import { ensureWorkerRunning, workerHttpRequest } from '../../shared/worker-utils.js';
import { isProjectExcluded } from '../../utils/project-filter.js';
import { logger } from '../../utils/logger.js';
import { HOOK_EXIT_CODES } from '../../shared/hook-constants.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH } from '../../shared/paths.js';

const BRIEFING_TIMEOUT_MS = 8000;

export const preCompactHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    // Always exit 0 — never block compaction
    const safe: HookResult = { exitCode: HOOK_EXIT_CODES.SUCCESS };

    try {
      const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
      if (settings.CLAUDE_MEM_AMNESIA_RECOVERY_ENABLED !== 'true') return safe;

      const cwd = input.cwd ?? '';
      if (isProjectExcluded(cwd, settings.CLAUDE_MEM_EXCLUDED_PROJECTS)) return safe;

      const workerRunning = await ensureWorkerRunning();
      if (!workerRunning) return safe;

      // Read transcript tail from hook payload (Claude Code provides transcript path)
      const transcriptPath = (input.payload as any)?.transcript_path as string | undefined;
      let transcriptTail = '';
      if (transcriptPath) {
        try {
          const { readFileSync } = await import('fs');
          const content = readFileSync(transcriptPath, 'utf-8');
          transcriptTail = content.slice(-6000);
        } catch { /* transcript unreadable — proceed with template-only */ }
      }

      const body = {
        memorySessionId: input.sessionId ?? '',
        project: cwd,
        transcriptTail,
        recentFiles: [],   // worker will enrich from its own session state
        openTodos: [],
        recentDecisions: [],
        recentErrors: [],
      };

      await workerHttpRequest('/api/briefings/generate', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        timeoutMs: BRIEFING_TIMEOUT_MS,
      });
      logger.debug({ project: cwd }, 'amnesia recovery: briefing generated');
    } catch (err) {
      // Never let errors surface — compaction must not be blocked
      logger.debug({ err }, 'amnesia recovery: pre-compact handler error (suppressed)');
    }

    return safe;
  },
};
```

- [ ] **Step 4: Register handler in handlers/index.ts**

In `src/cli/handlers/index.ts`:

1. Add `'pre-compact'` to the `EventType` union (line ~19):
```typescript
export type EventType =
  | 'context'
  | 'session-init'
  | 'observation'
  | 'summarize'
  | 'session-complete'
  | 'user-message'
  | 'file-edit'
  | 'file-context'
  | 'pre-compact';  // add this
```

2. Add import at top:
```typescript
import { preCompactHandler } from './pre-compact.js';
```

3. Add case in `getEventHandler()`:
```typescript
case 'pre-compact': return preCompactHandler;
```

- [ ] **Step 5: Run tests**

```bash
bun test src/cli/handlers/__tests__/pre-compact.test.ts
bun test
```
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/handlers/pre-compact.ts src/cli/handlers/__tests__/pre-compact.test.ts src/cli/handlers/index.ts
git commit -m "feat(amnesia): add pre-compact hook handler"
```

---

## Task 6: SessionStart briefing injection

Modify `context.ts` to fetch `GET /api/briefings/pending` after building normal context, then prepend the briefing if one exists.

**Files:**
- Modify: `src/cli/handlers/context.ts` (execute() at L18–97)

The handler returns `additionalContext` string for Claude Code injection. Prepend briefing before that string.

- [ ] **Step 1: Understand context.ts injection shape**

Read L18–97 of `src/cli/handlers/context.ts` to see how `additionalContext` is built before modifying.

```bash
# Read the full execute() body to find the additionalContext return point
```

Use: read with offset=18, limit=80.

- [ ] **Step 2: Add briefing injection after existing context fetch**

After the existing `workerHttpRequest('/api/context/inject', ...)` call, and after `additionalContext` is built, add:

```typescript
// Amnesia Recovery: prepend pending briefing if available
const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
if (settings.CLAUDE_MEM_AMNESIA_RECOVERY_ENABLED === 'true') {
  try {
    const resp = await workerHttpRequest(
      `/api/briefings/pending?project=${encodeURIComponent(projectContext.cwd)}`,
      { timeoutMs: 3000 }
    );
    const briefingRes = await resp.json() as { briefing: string | null };
    if (briefingRes?.briefing) {
      const header = '---\n## 🧠 Session Resumed (Amnesia Recovery)\n';
      additionalContext = `${header}${briefingRes.briefing}\n---\n\n${additionalContext}`;
      logger.debug({ project: projectContext.cwd }, 'amnesia recovery: briefing injected');
    }
  } catch (err) {
    logger.debug({ err }, 'amnesia recovery: briefing fetch failed (suppressed)');
  }
}
```

- [ ] **Step 3: Run full test suite**

```bash
bun test
```
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli/handlers/context.ts
git commit -m "feat(amnesia): inject pending briefing at SessionStart"
```

---

## Task 7: Settings + build wiring

**Files:**
- Modify: `src/shared/SettingsDefaultsManager.ts` (add `CLAUDE_MEM_AMNESIA_RECOVERY_ENABLED` field)
- Verify build succeeds

- [ ] **Step 1: Find SettingsDefaultsManager and add the flag**

Check existing boolean flags in `src/shared/SettingsDefaultsManager.ts` via `smart_outline`, then add:

```typescript
// In the SettingsDefaults interface (all fields are string):
CLAUDE_MEM_AMNESIA_RECOVERY_ENABLED: string;

// In the defaults object:
CLAUDE_MEM_AMNESIA_RECOVERY_ENABLED: 'false',
```

Follow the EXACT same pattern as `CLAUDE_MEM_LEARNING_EXTRACTION_ENABLED` (which is typed `string` and defaults to `'true'`). All flags in SettingsDefaults are `string` — never `boolean`. Check with `=== 'true'`, not truthiness.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
bun run build
```
Expected: no TypeScript errors

- [ ] **Step 3: Run full test suite**

```bash
bun test
```
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add src/shared/SettingsDefaultsManager.ts
git commit -m "feat(amnesia): add CLAUDE_MEM_AMNESIA_RECOVERY_ENABLED setting flag"
```

---

## Verification Checklist

After all tasks complete, verify end-to-end behavior:

- [ ] `CLAUDE_MEM_AMNESIA_RECOVERY_ENABLED=false` (default) — PreCompact hook exits 0, no DB rows written, SessionStart injects nothing
- [ ] `CLAUDE_MEM_AMNESIA_RECOVERY_ENABLED=true` — PreCompact hook writes a row to `session_briefings`, SessionStart retrieves and prepends it
- [ ] Second SessionStart after briefing consumed — no duplicate injection (row has `consumed_at` set)
- [ ] LLM unavailable — template-only briefing still generated and injected
- [ ] `bun test` — all 12+ test files pass
- [ ] `bun run build` — no TypeScript errors

---

## Key implementation gotchas

1. **Migration v32, not v28** — spec was written before migrations 28–31 were added. Use v32 in `runner.ts`.
2. **Atomic consume** — `getPendingAndConsume()` must use `db.transaction()` to prevent double-injection if two SessionStart hooks race.
3. **Always exit 0 in pre-compact.ts** — ALL errors must be caught. Wrap the entire body in try/catch.
4. **No `AbortSignal.timeout` in Bun on Windows** — follow the same workaround as `context.ts` (use worker-side timeouts, not `AbortSignal`).
5. **Feature flag from settings file** — read via `SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH)`, not `process.env`, consistent with `CLAUDE_MEM_LEARNING_EXTRACTION_ENABLED` pattern (see obs 1195).
6. **workerHttpRequest signature** — `workerHttpRequest(apiPath: string, options: { method?, headers?, body?: string, timeoutMs?: number })`. Returns `Promise<Response>` — must call `.json()` separately. POST calls need `body: JSON.stringify(data)` and `headers: { 'Content-Type': 'application/json' }`.
7. **BriefingStore needs `db` from the worker's initialized DatabaseManager** — get it via `this.dbManager.getConnection()` or equivalent after initialization.
