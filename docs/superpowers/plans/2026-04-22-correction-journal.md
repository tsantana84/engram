# Structured Correction Journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user corrects the agent mid-session, capture a typed `{tried, wrong_because, fix, trigger_context}` record with a retrieval-weight bonus, auto-inject top corrections into session prewarm, and boost correction results in search.

**Architecture:** UserPromptSubmit fires → `SessionRoutes.handleSessionInitByClaudeId` runs heuristic gate on user message → if match, async LLM extraction via `CorrectionExtractor` → atomic dual-write to `corrections` + `observations` tables. SessionStart context generation queries corrections table and prepends top-3 matches to prewarm output. Search scoring multiplies correction results by `weight_multiplier`.

**Tech Stack:** TypeScript, Bun/SQLite (`bun:sqlite`), Express (BaseRouteHandler pattern), existing worker HTTP server on port 37777.

**Spec:** `docs/superpowers/specs/2026-04-22-correction-journal-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/services/sqlite/migrations/runner.ts` | Add `createCorrectionsTable()` migration method + call in `runAllMigrations()` |
| Modify | `src/services/sqlite/SessionStore.ts` | Same method + call in constructor (after `createTickLogTable()`) |
| Modify | `src/services/sqlite/types.ts:209` | Add `'correction'` to `ObservationRow['type']` union |
| Modify | `src/types/database.ts:69` | Same union update |
| Script | `scripts/add-correction-type-to-modes.cjs` | One-shot script: adds `'correction'` to `observation_types` in all 36 `plugin/modes/*.json` files |
| Create | `src/services/sync/CorrectionExtractor.ts` | Config interface, `CorrectionExtractor` class, LLM extraction, atomic dual-write |
| Create | `src/services/worker/http/routes/CorrectionRoutes.ts` | `POST /api/corrections` endpoint |
| Modify | `src/services/worker/WorkerService.ts` (or router setup file) | Register `CorrectionRoutes` |
| Modify | `src/services/worker/http/routes/SessionRoutes.ts` | Heuristic gate in `handleSessionInitByClaudeId` |
| Modify | `src/services/context/ContextBuilder.ts` | Query corrections + prepend prewarm block in `generateContext` |
| Modify | `src/services/worker/SearchManager.ts` | Weight multiplier after `queryChroma()` at line ~187 |

**Build after all tasks:** `npm run build-and-sync`

---

## Task 1: Corrections Table (Migration 35)

**Files:**
- Modify: `src/services/sqlite/migrations/runner.ts`
- Modify: `src/services/sqlite/SessionStore.ts`
- Test: `src/services/sqlite/__tests__/corrections-table.test.ts` (create)

- [ ] **Step 1: Write failing test**

```typescript
// src/services/sqlite/__tests__/corrections-table.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../SessionStore.js';

describe('corrections table', () => {
  let store: SessionStore;
  beforeEach(() => { store = new SessionStore(':memory:'); });
  afterEach(() => { store.close(); });

  it('creates corrections table with required columns', () => {
    const row = store.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='corrections'"
    ).get();
    expect(row).toBeTruthy();
  });

  it('creates index on trigger_context', () => {
    const row = store.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_corrections_trigger'"
    ).get();
    expect(row).toBeTruthy();
  });

  it('creates index on project', () => {
    const row = store.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_corrections_project'"
    ).get();
    expect(row).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
bun test src/services/sqlite/__tests__/corrections-table.test.ts
```

Expected: `corrections table > creates corrections table...` FAIL

- [ ] **Step 3: Add `createCorrectionsTable()` to runner.ts**

In `src/services/sqlite/migrations/runner.ts`, add after `createGraphEdgesTable()` call in `runAllMigrations()`:
```typescript
this.createCorrectionsTable();
```

Add the method:
```typescript
private createCorrectionsTable(): void {
  this.db.run(`
    CREATE TABLE IF NOT EXISTS corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tried TEXT NOT NULL,
      wrong_because TEXT NOT NULL,
      fix TEXT NOT NULL,
      trigger_context TEXT NOT NULL,
      weight_multiplier REAL NOT NULL DEFAULT 2.0,
      session_id TEXT,
      project TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  this.db.run(`CREATE INDEX IF NOT EXISTS idx_corrections_trigger ON corrections(trigger_context)`);
  this.db.run(`CREATE INDEX IF NOT EXISTS idx_corrections_project ON corrections(project)`);
}
```

- [ ] **Step 4: Add same method + call to SessionStore.ts**

In `src/services/sqlite/SessionStore.ts`, after `this.createTickLogTable()` in the constructor:
```typescript
this.createCorrectionsTable();
```

Add the same method body as above (copy exactly).

- [ ] **Step 5: Run test — expect PASS**

```bash
bun test src/services/sqlite/__tests__/corrections-table.test.ts
```

Expected: all 3 tests PASS

- [ ] **Step 6: Run full suite — verify no regressions**

```bash
bun test --timeout 30000
```

Expected: same pass count as before (currently ~1521 pass, 4 pre-existing failures in POST /api/sync/learnings)

- [ ] **Step 7: Commit**

```bash
git add src/services/sqlite/migrations/runner.ts src/services/sqlite/SessionStore.ts src/services/sqlite/__tests__/corrections-table.test.ts
git commit -m "feat(corrections): add corrections table migration 35"
```

---

## Task 2: Type System Updates

**Files:**
- Modify: `src/services/sqlite/types.ts:209`
- Modify: `src/types/database.ts` (find ObservationRow type union)
- Create: `scripts/add-correction-type-to-modes.cjs`

- [ ] **Step 1: Update ObservationRow type in types.ts**

In `src/services/sqlite/types.ts` line 209, change:
```typescript
type: 'decision' | 'bugfix' | 'feature' | 'refactor' | 'discovery' | 'change';
```
to:
```typescript
type: 'decision' | 'bugfix' | 'feature' | 'refactor' | 'discovery' | 'change' | 'correction';
```

- [ ] **Step 2: Update same union in database.ts**

Find the `ObservationRow` interface in `src/types/database.ts` and apply the same `| 'correction'` addition.

- [ ] **Step 3: Write mode-update script**

```javascript
// scripts/add-correction-type-to-modes.cjs
const fs = require('fs');
const path = require('path');

const modesDir = path.join(__dirname, '..', 'plugin', 'modes');
const files = fs.readdirSync(modesDir).filter(f => f.endsWith('.json'));

let updated = 0;
for (const file of files) {
  const filePath = path.join(modesDir, file);
  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (Array.isArray(content.observation_types) && !content.observation_types.includes('correction')) {
    content.observation_types.push('correction');
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n');
    updated++;
  }
}
console.log(`Updated ${updated}/${files.length} mode files`);
```

- [ ] **Step 4: Run the script**

```bash
node scripts/add-correction-type-to-modes.cjs
```

Expected: `Updated 36/36 mode files` (or similar)

- [ ] **Step 5: Spot-check one mode file**

```bash
node -e "const m = require('./plugin/modes/code.json'); console.log(m.observation_types.includes('correction'))"
```

Expected: `true`

- [ ] **Step 6: Commit**

```bash
git add src/services/sqlite/types.ts src/types/database.ts scripts/add-correction-type-to-modes.cjs plugin/modes/
git commit -m "feat(corrections): add 'correction' to type union and all mode JSONs"
```

---

## Task 3: CorrectionExtractor Service

**Files:**
- Create: `src/services/sync/CorrectionExtractor.ts`
- Create: `src/services/sync/__tests__/CorrectionExtractor.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/services/sync/__tests__/CorrectionExtractor.test.ts
import { describe, it, expect } from 'bun:test';
import { CorrectionExtractor } from '../CorrectionExtractor.js';

describe('CorrectionExtractor', () => {
  it('returns null when LLM returns null', async () => {
    const extractor = new CorrectionExtractor({
      enabled: true,
      llm: async () => 'null',
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 300,
    });
    const result = await extractor.extract('some context');
    expect(result).toBeNull();
  });

  it('parses valid correction JSON', async () => {
    const record = { tried: 'use rm -rf', wrong_because: 'destructive', fix: 'use trash command', trigger_context: 'deleting files' };
    const extractor = new CorrectionExtractor({
      enabled: true,
      llm: async () => JSON.stringify(record),
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 300,
    });
    const result = await extractor.extract('context');
    expect(result).toEqual(record);
  });

  it('returns null when trigger_context is empty', async () => {
    const record = { tried: 'x', wrong_because: 'y', fix: 'z', trigger_context: '' };
    const extractor = new CorrectionExtractor({
      enabled: true,
      llm: async () => JSON.stringify(record),
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 300,
    });
    expect(await extractor.extract('context')).toBeNull();
  });

  it('returns null when disabled', async () => {
    const extractor = new CorrectionExtractor({
      enabled: false,
      llm: async () => '{}',
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 300,
    });
    expect(await extractor.extract('context')).toBeNull();
  });

  it('returns null on LLM error', async () => {
    const extractor = new CorrectionExtractor({
      enabled: true,
      llm: async () => { throw new Error('LLM failed'); },
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 300,
    });
    expect(await extractor.extract('context')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
bun test src/services/sync/__tests__/CorrectionExtractor.test.ts
```

Expected: FAIL (module not found)

- [ ] **Step 3: Implement CorrectionExtractor**

```typescript
// src/services/sync/CorrectionExtractor.ts
import { logger } from '../../utils/logger.js';

export interface CorrectionExtractorConfig {
  enabled: boolean;
  llm: (prompt: string) => Promise<string>;
  model: string;
  maxTokens: number;
}

export interface CorrectionRecord {
  tried: string;
  wrong_because: string;
  fix: string;
  trigger_context: string;
  session_id?: string;
  project?: string;
}

const EXTRACTION_PROMPT = (context: string) => `Extract a correction from this exchange. Return null if no clear mistake was made by the assistant.

${context}

Return JSON or the literal null:
{"tried": "what the assistant attempted", "wrong_because": "why it was wrong", "fix": "the correct approach", "trigger_context": "3-6 word phrase for when this mistake recurs"}

Rules:
- trigger_context must be non-empty (e.g. "deleting files safely", "writing commit messages")
- Return null if no assistant mistake is evident
- Return null if trigger_context would be empty`;

export class CorrectionExtractor {
  private config: CorrectionExtractorConfig;

  constructor(config: CorrectionExtractorConfig) {
    this.config = config;
  }

  async extract(context: string): Promise<CorrectionRecord | null> {
    if (!this.config.enabled) return null;

    try {
      const raw = await this.config.llm(EXTRACTION_PROMPT(context));
      const trimmed = raw.trim();
      if (trimmed === 'null' || trimmed === '') return null;

      const parsed = JSON.parse(trimmed) as Partial<CorrectionRecord>;
      if (!parsed.tried || !parsed.wrong_because || !parsed.fix || !parsed.trigger_context) return null;
      if (!parsed.trigger_context.trim()) return null;

      return {
        tried: parsed.tried,
        wrong_because: parsed.wrong_because,
        fix: parsed.fix,
        trigger_context: parsed.trigger_context,
      };
    } catch (err) {
      logger.debug('CORRECTION', 'Extraction failed', {}, err as Error);
      return null;
    }
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
bun test src/services/sync/__tests__/CorrectionExtractor.test.ts
```

Expected: all 5 tests PASS

- [ ] **Step 5: Run full suite**

```bash
bun test --timeout 30000
```

Expected: no regressions

- [ ] **Step 6: Commit**

```bash
git add src/services/sync/CorrectionExtractor.ts src/services/sync/__tests__/CorrectionExtractor.test.ts
git commit -m "feat(corrections): add CorrectionExtractor service"
```

---

## Task 4: Worker POST Route

**Files:**
- Create: `src/services/worker/http/routes/CorrectionRoutes.ts`
- Modify: worker route registration file (find where other Routes are registered, e.g. `src/services/worker/WorkerService.ts` or `src/services/worker/http/Router.ts`)

- [ ] **Step 1: Find route registration file**

```bash
grep -rn "new SessionRoutes\|new MemoryRoutes\|new SearchRoutes\|setupRoutes" src/services/worker/ --include="*.ts" | grep -v "test\|spec" | head -10
```

Note the file and line where routes are registered.

- [ ] **Step 2: Write failing test**

```typescript
// src/services/worker/http/routes/__tests__/CorrectionRoutes.test.ts
import { describe, it, expect } from 'bun:test';
import express from 'express';
import request from 'supertest';

// Minimal mock DatabaseManager
const mockStore = {
  db: {
    transaction: (fn: Function) => fn,
    prepare: () => ({ run: () => {} }),
  },
  storeObservation: () => ({ id: 1, createdAtEpoch: Date.now() }),
  getOrCreateManualSession: () => 'session-1',
};
const mockDbManager = {
  getSessionStore: () => mockStore,
};

describe('CorrectionRoutes POST /api/corrections', () => {
  it('returns 400 when required fields missing', async () => {
    const { CorrectionRoutes } = await import('../CorrectionRoutes.js');
    const app = express();
    app.use(express.json());
    new CorrectionRoutes(mockDbManager as any).setupRoutes(app);

    const res = await request(app).post('/api/corrections').send({ tried: 'x' });
    expect(res.status).toBe(400);
  });

  it('returns 200 on valid correction', async () => {
    const { CorrectionRoutes } = await import('../CorrectionRoutes.js');
    const app = express();
    app.use(express.json());
    new CorrectionRoutes(mockDbManager as any).setupRoutes(app);

    const res = await request(app).post('/api/corrections').send({
      tried: 'use rm -rf',
      wrong_because: 'destructive',
      fix: 'use trash',
      trigger_context: 'deleting files',
      project: '/test/project',
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

```bash
bun test src/services/worker/http/routes/__tests__/CorrectionRoutes.test.ts
```

Expected: FAIL (module not found)

- [ ] **Step 4: Implement CorrectionRoutes**

```typescript
// src/services/worker/http/routes/CorrectionRoutes.ts
import express, { Request, Response } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { logger } from '../../../../utils/logger.js';
import type { DatabaseManager } from '../../DatabaseManager.js';

export class CorrectionRoutes extends BaseRouteHandler {
  constructor(private dbManager: DatabaseManager) {
    super();
  }

  setupRoutes(app: express.Application): void {
    app.post('/api/corrections', this.handleStoreCorrection.bind(this));
  }

  private handleStoreCorrection = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const { tried, wrong_because, fix, trigger_context, session_id, project } = req.body;

    if (!tried || !wrong_because || !fix || !trigger_context) {
      this.badRequest(res, 'tried, wrong_because, fix, trigger_context are required');
      return;
    }
    if (!trigger_context.trim()) {
      this.badRequest(res, 'trigger_context must be non-empty');
      return;
    }

    const store = this.dbManager.getSessionStore();

    // Atomic dual-write: corrections table + observations table
    const write = store.db.transaction(() => {
      store.db.prepare(`
        INSERT INTO corrections (tried, wrong_because, fix, trigger_context, session_id, project, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(tried, wrong_because, fix, trigger_context, session_id ?? null, project ?? null, Date.now());

      const memorySessionId = session_id ?? store.getOrCreateManualSession(project ?? '');
      return store.storeObservation(memorySessionId, project ?? '', {
        type: 'correction',
        title: `Correction: ${tried.slice(0, 60)}`,
        subtitle: `Fix: ${fix.slice(0, 60)}`,
        facts: [wrong_because],
        narrative: `Tried: ${tried}. Wrong because: ${wrong_because}. Fix: ${fix}. Context: ${trigger_context}`,
        concepts: ['correction', trigger_context],
        files_read: [],
        files_modified: [],
      }, 0, 0);
    });

    const result = write();
    logger.info('CORRECTION', 'Stored correction', { id: result.id, trigger_context });

    res.json({ success: true, id: result.id });
  });
}
```

- [ ] **Step 5: Register the route**

In the route registration file found in Step 1, add:
```typescript
import { CorrectionRoutes } from './http/routes/CorrectionRoutes.js';
// ...
new CorrectionRoutes(this.dbManager).setupRoutes(app);
```

- [ ] **Step 6: Run test — expect PASS**

```bash
bun test src/services/worker/http/routes/__tests__/CorrectionRoutes.test.ts
```

- [ ] **Step 7: Run full suite**

```bash
bun test --timeout 30000
```

- [ ] **Step 8: Commit**

```bash
git add src/services/worker/http/routes/CorrectionRoutes.ts src/services/worker/http/routes/__tests__/CorrectionRoutes.test.ts
git commit -m "feat(corrections): add POST /api/corrections worker route"
```

---

## Task 5: Heuristic Gate in Session-Init

**Files:**
- Modify: `src/services/worker/http/routes/SessionRoutes.ts` (around line 331 — `handleSessionInitByClaudeId`)

- [ ] **Step 1: Read the handler**

Read `src/services/worker/http/routes/SessionRoutes.ts` lines 331–430 to understand the existing session-init body parsing and what fields are available (look for `user_message`, `prompt`, or similar in `req.body`).

- [ ] **Step 2: Write test for heuristic gate (unit)**

```typescript
// src/services/worker/http/routes/__tests__/correction-gate.test.ts
import { describe, it, expect } from 'bun:test';

const CORRECTION_GATE = /\b(wrong|incorrect|stop doing|that's not right|don't do that|that was wrong|you shouldn't)\b/i;

describe('correction heuristic gate', () => {
  it('fires on "wrong"', () => expect(CORRECTION_GATE.test("that's wrong")).toBe(true));
  it('fires on "incorrect"', () => expect(CORRECTION_GATE.test("that's incorrect")).toBe(true));
  it('fires on "stop doing"', () => expect(CORRECTION_GATE.test('stop doing that')).toBe(true));
  it('does not fire on "no"', () => expect(CORRECTION_GATE.test('no')).toBe(false));
  it('does not fire on "instead"', () => expect(CORRECTION_GATE.test('use a map instead')).toBe(false));
  it('does not fire on "actually,"', () => expect(CORRECTION_GATE.test('actually, more context')).toBe(false));
});
```

- [ ] **Step 3: Run gate test — expect PASS**

```bash
bun test src/services/worker/http/routes/__tests__/correction-gate.test.ts
```

- [ ] **Step 4: Add gate to session-init handler**

In `SessionRoutes.ts`, at the end of `handleSessionInitByClaudeId` (after all existing logic), add the async correction check. Find where `req.body` contains the user prompt text (may be `req.body.prompt`, `req.body.user_message`, or similar — check from Step 1).

```typescript
// At end of handleSessionInitByClaudeId, before sending response:
const userMessage: string = req.body.prompt ?? req.body.user_message ?? '';
const CORRECTION_GATE = /\b(wrong|incorrect|stop doing|that's not right|don't do that|that was wrong|you shouldn't)\b/i;

if (userMessage && CORRECTION_GATE.test(userMessage)) {
  // Build context from transcript tail + user message (non-blocking)
  setImmediate(async () => {
    try {
      const transcriptPath: string = req.body.transcript_path ?? '';
      let transcriptTail = '';
      if (transcriptPath) {
        const { readFileSync, existsSync } = await import('fs');
        if (existsSync(transcriptPath)) {
          transcriptTail = readFileSync(transcriptPath, 'utf-8').slice(-6000);
        }
      }
      const context = `${transcriptTail}\n\nUser correction: ${userMessage}`;

      const { CorrectionExtractor } = await import('../../../sync/CorrectionExtractor.js');
      // Get llm from worker's existing LLM config (same pattern as LearningExtractor wiring)
      // TODO: wire up this.llm from WorkerService constructor (match LearningExtractor wiring pattern)
      const extractor = new CorrectionExtractor({
        enabled: true,
        llm: this.llm,  // injected via constructor like LearningExtractor
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 300,
      });
      const record = await extractor.extract(context);
      if (record) {
        record.session_id = req.body.session_id;
        record.project = req.body.cwd ?? req.body.project;
        await fetch(`http://localhost:${this.port}/api/corrections`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record),
        });
      }
    } catch (err) {
      logger.debug('CORRECTION', 'Gate processing failed silently', {}, err as Error);
    }
  });
}
```

**Note:** Check how `LearningExtractor` receives its `llm` callback in the existing `SessionRoutes` constructor — wire `CorrectionExtractor` the same way. Look for `this.llm` or similar injected dependency.

- [ ] **Step 5: Build and smoke-test**

```bash
npm run build-and-sync
```

In a Claude Code session, type a message containing "wrong" or "stop doing that". Check logs:

```bash
tail -f ~/.engram/logs/engram-$(date +%Y-%m-%d).log | grep -i correction
```

Expected: see `CORRECTION` log entries on correction-triggering messages, nothing on normal messages.

- [ ] **Step 6: Commit**

```bash
git add src/services/worker/http/routes/SessionRoutes.ts src/services/worker/http/routes/__tests__/correction-gate.test.ts
git commit -m "feat(corrections): add heuristic gate in session-init"
```

---

## Task 6: Prewarm Injection in ContextBuilder

**Files:**
- Modify: `src/services/context/ContextBuilder.ts`

The `generateContext` function builds the session context injected at `SessionStart`. We add a corrections prewarm block at the top of the output when relevant corrections exist.

- [ ] **Step 1: Write test**

```typescript
// src/services/context/__tests__/corrections-prewarm.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../../sqlite/SessionStore.js';

describe('corrections prewarm query', () => {
  let store: SessionStore;
  beforeEach(() => { store = new SessionStore(':memory:'); });
  afterEach(() => { store.close(); });

  it('fetches corrections for project', () => {
    store.db.prepare(`
      INSERT INTO corrections (tried, wrong_because, fix, trigger_context, project, created_at)
      VALUES ('rm -rf', 'destructive', 'use trash', 'deleting files', '/my/project', ?)
    `).run(Date.now());

    const rows = store.db.prepare(`
      SELECT tried, wrong_because, fix, trigger_context
      FROM corrections
      WHERE project = ? AND trigger_context != ''
      ORDER BY weight_multiplier DESC, created_at DESC
      LIMIT 10
    `).all('/my/project') as any[];

    expect(rows.length).toBe(1);
    expect(rows[0].tried).toBe('rm -rf');
  });

  it('excludes corrections from other projects', () => {
    store.db.prepare(`
      INSERT INTO corrections (tried, wrong_because, fix, trigger_context, project, created_at)
      VALUES ('x', 'y', 'z', 'some context', '/other/project', ?)
    `).run(Date.now());

    const rows = store.db.prepare(`
      SELECT * FROM corrections WHERE project = ? AND trigger_context != ''
    `).all('/my/project') as any[];

    expect(rows.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — expect PASS** (table already created in Task 1)

```bash
bun test src/services/context/__tests__/corrections-prewarm.test.ts
```

- [ ] **Step 3: Add `queryCorrections` helper to ContextBuilder**

In `src/services/context/ContextBuilder.ts`, add after the imports:

```typescript
interface CorrectionPrewarm {
  tried: string;
  wrong_because: string;
  fix: string;
  trigger_context: string;
}

function queryCorrections(db: SessionStore, project: string): CorrectionPrewarm[] {
  try {
    return db.db.prepare(`
      SELECT tried, wrong_because, fix, trigger_context
      FROM corrections
      WHERE project = ? AND trigger_context != ''
      ORDER BY weight_multiplier DESC, created_at DESC
      LIMIT 10
    `).all(project) as CorrectionPrewarm[];
  } catch {
    return [];
  }
}

function scoreCorrections(corrections: CorrectionPrewarm[], goal: string): CorrectionPrewarm[] {
  if (!goal) return corrections.slice(0, 3);
  const goalWords = new Set(goal.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  return corrections
    .map(c => ({
      correction: c,
      score: c.trigger_context.toLowerCase().split(/\W+/).filter(w => goalWords.has(w)).length,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(x => x.correction);
}

function renderCorrectionsBlock(corrections: CorrectionPrewarm[]): string {
  if (corrections.length === 0) return '';
  const lines = corrections.map(c =>
    `- Tried: ${c.tried}. Wrong because: ${c.wrong_because}. Fix: ${c.fix}.\n  [Context: ${c.trigger_context}]`
  );
  return `\n## PAST CORRECTIONS (high priority)\n${lines.join('\n')}\n`;
}
```

- [ ] **Step 4: Wire corrections into generateContext**

In `generateContext`, after `const db = initializeDatabase()` and the `if (!db)` guard, add:

```typescript
// Query corrections for prewarm (project-scoped, keyword-scored)
const allCorrections = queryCorrections(db, project);
// Use most recent observation title as session goal proxy
const goalProxy = ''; // populated below after observations load
```

Then after `const observations = ...` is loaded, add:

```typescript
const correctionGoal = observations[0]?.title ?? '';
const prewarmCorrections = scoreCorrections(allCorrections, correctionGoal);
const correctionsBlock = renderCorrectionsBlock(prewarmCorrections);
```

Finally, prepend `correctionsBlock` to the returned string:

```typescript
return correctionsBlock + output;
```

(If `output` is returned from `buildContextOutput`, prepend before returning.)

- [ ] **Step 5: Build and verify**

```bash
npm run build-and-sync
```

Start a new Claude Code session. After at least one correction has been stored (from Task 5), the session context should include a `## PAST CORRECTIONS` block.

Check worker logs:
```bash
tail -f ~/.engram/logs/engram-$(date +%Y-%m-%d).log | grep -i correction
```

- [ ] **Step 6: Commit**

```bash
git add src/services/context/ContextBuilder.ts src/services/context/__tests__/corrections-prewarm.test.ts
git commit -m "feat(corrections): inject corrections prewarm in SessionStart context"
```

---

## Task 7: Weight Bonus in SearchManager

**Files:**
- Modify: `src/services/worker/SearchManager.ts` (around line 187 — main `search()` path after `queryChroma()`)

- [ ] **Step 1: Write test**

```typescript
// src/services/worker/__tests__/correction-weight.test.ts
import { describe, it, expect } from 'bun:test';

function applyWeightBonus(
  ids: number[],
  correctionIds: Set<number>,
  distances: number[]
): number[] {
  return distances.map((d, i) => correctionIds.has(ids[i]) ? d * 0.5 : d); // lower distance = higher rank
}

describe('correction weight bonus', () => {
  it('halves distance for correction observations', () => {
    const ids = [1, 2, 3];
    const correctionIds = new Set([2]);
    const distances = [0.4, 0.4, 0.4];
    const adjusted = applyWeightBonus(ids, correctionIds, distances);
    expect(adjusted[1]).toBeLessThan(adjusted[0]);
  });

  it('leaves non-correction distances unchanged', () => {
    const ids = [1, 2];
    const correctionIds = new Set<number>();
    const distances = [0.3, 0.5];
    const adjusted = applyWeightBonus(ids, correctionIds, distances);
    expect(adjusted).toEqual([0.3, 0.5]);
  });
});
```

- [ ] **Step 2: Run test — expect PASS** (pure function, no imports needed)

```bash
bun test src/services/worker/__tests__/correction-weight.test.ts
```

- [ ] **Step 3: Add weight bonus to SearchManager**

In `src/services/worker/SearchManager.ts`, find the method containing the call at line ~187:
```typescript
const chromaResults = await this.queryChroma(query, 100, whereFilter);
```

After this line, add the correction weight boost:

```typescript
// Apply correction weight bonus: lower distance = higher rank
if (chromaResults.ids.length > 0) {
  const correctionRows = this.dbManager.getSessionStore().db.prepare(
    `SELECT o.id FROM observations o WHERE o.type = 'correction' AND o.id IN (${chromaResults.ids.map(() => '?').join(',')})`
  ).all(...chromaResults.ids) as { id: number }[];
  const correctionIds = new Set(correctionRows.map(r => r.id));
  if (correctionIds.size > 0) {
    chromaResults.distances = chromaResults.distances.map((d, i) =>
      correctionIds.has(chromaResults.ids[i]) ? d / 2.0 : d
    );
  }
}
```

**Note:** `d / 2.0` halves the distance (effectively doubles the relevance weight) for correction observations. This matches `weight_multiplier: 2.0` from the spec.

- [ ] **Step 4: Run full suite**

```bash
bun test --timeout 30000
```

Expected: no regressions

- [ ] **Step 5: Build**

```bash
npm run build-and-sync
```

- [ ] **Step 6: Commit**

```bash
git add src/services/worker/SearchManager.ts src/services/worker/__tests__/correction-weight.test.ts
git commit -m "feat(corrections): apply weight bonus to correction observations in search"
```

---

## Task 8: Add Correction Feature to ROADMAP.md

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Add to P1 section**

Add Structured Correction Journal as a P1 item in `ROADMAP.md`. Mark Memory Graph as ✅ complete (already shipped). Add the new item with the same format as existing P1 items:

```markdown
### P1 — Structured Correction Journal
When the user explicitly corrects the agent mid-session, store a typed correction record: `{tried, wrong_because, fix, trigger_context}`. Corrections receive a retrieval weight bonus (2×) and are auto-injected into session prewarm when the session goal matches `trigger_context`. Detection: keyword heuristic gate at UserPromptSubmit, LLM extraction only when gate fires.
```

- [ ] **Step 2: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: add Structured Correction Journal to P1 roadmap"
```

---

## Final Verification

- [ ] Run full test suite: `bun test --timeout 30000` — same pass count, no new failures
- [ ] Build: `npm run build-and-sync`
- [ ] Trigger a correction: in Claude Code, write "stop doing that" after an agent action
- [ ] Check DB: `sqlite3 ~/.engram/claude-mem.db "SELECT tried, wrong_because, fix, trigger_context FROM corrections LIMIT 5;"`
- [ ] Check observations: `sqlite3 ~/.engram/claude-mem.db "SELECT id, type, title FROM observations WHERE type='correction' LIMIT 5;"`
- [ ] Start new session: verify `## PAST CORRECTIONS` appears in prewarm context
- [ ] Search: run `mem-search` for a topic matching a correction — verify correction appears near top
