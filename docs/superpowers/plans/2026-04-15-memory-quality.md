# Memory Quality & Conflict Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent wrong-premise observations from polluting the shared brain by adding conflict detection at write time, temporal retention instead of deletion, source attribution with git branch context, and a PR merge validation gate.

**Architecture:** Four independent layers that compose: (1) every observation gets enriched with branch/session provenance at write time; (2) a conflict detection step runs before syncing to Supabase, using LLM-as-classifier (Mem0 pattern) to ADD/UPDATE/INVALIDATE/NOOP; (3) superseded observations are never deleted — they get an `invalidated_at` timestamp; (4) observations from unmerged branches are flagged as `unvalidated` and weighted lower in retrieval.

**Tech Stack:** TypeScript, SQLite, Supabase, Vercel serverless functions, any LLM provider (Anthropic, Gemini, OpenRouter — routed via the existing `CLAUDE_MEM_PROVIDER` setting), `execFileNoThrow` utility (use instead of execSync — see `src/utils/execFileNoThrow.ts`)

---

## File Map

| File | Change |
|------|--------|
| `src/services/sqlite/migrations.ts` | Add migration: `git_branch`, `invalidated_at`, `validation_status` columns |
| `src/services/sqlite/SessionStore.ts` | Pass branch to `storeObservation`; add `invalidateObservation()` |
| `src/services/sync/SyncWorker.ts` | Run conflict detection before push |
| `src/services/sync/ConflictDetector.ts` | **New** — LLM-based conflict detection (ADD/UPDATE/INVALIDATE/NOOP) |
| `src/services/sync/SyncClient.ts` | Add `fetchSimilar()` and `pushInvalidations()` |
| `api/lib/SupabaseManager.ts` | Add provenance fields; add `invalidateObservations()` |
| `api/sync/invalidate.ts` | **New** — Vercel endpoint to mark observations as invalidated |
| `supabase/migrations/003_add_provenance_columns.sql` | **New** — Supabase migration |
| `src/cli/handlers/context.ts` | Filter invalidated from context injection |
| `src/services/worker/SearchManager.ts` | Flag unvalidated in team results merge |
| `tests/services/sync/ConflictDetector.test.ts` | **New test file** |

---

## Task 1: Add Database Columns for Provenance and Temporal Retention

**Files:**
- Modify: `src/services/sqlite/migrations.ts`
- Modify: `src/services/sqlite/SessionStore.ts`

- [ ] **Step 1: Write the failing migration test**

```typescript
// tests/services/sqlite/migrations.test.ts — add this test:
it('migration 28 adds git_branch, invalidated_at, validation_status columns', () => {
  const db = openTestDb();
  runMigrations(db);
  const cols = db.prepare("PRAGMA table_info(observations)").all().map((c: any) => c.name);
  expect(cols).toContain('git_branch');
  expect(cols).toContain('invalidated_at');
  expect(cols).toContain('validation_status');
});
```

Run: `bun test tests/services/sqlite/migrations.test.ts`
Expected: FAIL

- [ ] **Step 2: Add migration to `src/services/sqlite/migrations.ts`**

Find the latest migration version (check existing entries for the highest version number). Add:

```typescript
{
  version: 28,
  description: 'Add provenance and temporal retention columns to observations',
  up: (db: Database) => {
    db.exec(`ALTER TABLE observations ADD COLUMN git_branch TEXT`);
    db.exec(`ALTER TABLE observations ADD COLUMN invalidated_at INTEGER`);
    db.exec(`ALTER TABLE observations ADD COLUMN validation_status TEXT DEFAULT 'unvalidated'`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_observations_validation ON observations(validation_status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_observations_invalidated ON observations(invalidated_at)`);
  }
}
```

- [ ] **Step 3: Run test**

Run: `bun test tests/services/sqlite/migrations.test.ts`
Expected: PASS

- [ ] **Step 4: Add `invalidateObservation()` to SessionStore**

In `src/services/sqlite/SessionStore.ts`, add after `storeObservation`:

```typescript
invalidateObservation(id: number, reason?: string): void {
  const now = Date.now();
  this.db.prepare(`
    UPDATE observations 
    SET invalidated_at = ?, validation_status = 'invalidated'
    WHERE id = ?
  `).run(now, id);
  if (reason) {
    logger.info('MEMORY', `Observation #${id} invalidated: ${reason}`);
  }
}

validateObservation(id: number): void {
  this.db.prepare(`
    UPDATE observations SET validation_status = 'validated' WHERE id = ?
  `).run(id);
}
```

- [ ] **Step 5: Capture git branch in `storeObservation`**

In `src/services/sqlite/SessionStore.ts`, use `execFileNoThrow` (the project's safe exec utility at `src/utils/execFileNoThrow.ts`) to detect the current branch before INSERT:

```typescript
import { execFileNoThrow } from '../../utils/execFileNoThrow.js';

// At the start of storeObservation, before INSERT:
let gitBranch: string | null = null;
try {
  const result = await execFileNoThrow('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (result.status === 0) gitBranch = result.stdout.trim();
} catch { /* not in a git repo */ }

// Include in INSERT: git_branch column with gitBranch value
```

- [ ] **Step 6: Commit**

```bash
git add src/services/sqlite/migrations.ts src/services/sqlite/SessionStore.ts
git commit -m "feat: add git_branch, invalidated_at, validation_status to observations"
```

---

## Task 2: Build ConflictDetector

**Files:**
- Create: `src/services/sync/ConflictDetector.ts`
- Create: `tests/services/sync/ConflictDetector.test.ts`

LLM-as-classifier: before syncing a new observation, fetch top-5 similar observations from Supabase, pass them to claude-haiku, get back ADD/UPDATE/INVALIDATE/NOOP.

- [ ] **Step 1: Write failing tests**

Create `tests/services/sync/ConflictDetector.test.ts`:

```typescript
import { ConflictDetector } from '../../../src/services/sync/ConflictDetector';

describe('ConflictDetector', () => {
  it('returns ADD when no similar observations exist', async () => {
    const detector = new ConflictDetector({ 
      fetchSimilar: async () => [],
      llm: async () => ({ decision: 'ADD' as const })
    });
    const result = await detector.check({ title: 'New thing', narrative: 'details' });
    expect(result.decision).toBe('ADD');
  });

  it('returns INVALIDATE for directly contradicting observation', async () => {
    const detector = new ConflictDetector({
      fetchSimilar: async () => [{ id: 42, title: 'We use pattern X', narrative: 'X is standard', agent_name: 'thiago' }],
      llm: async () => ({ decision: 'INVALIDATE' as const, targetId: 42, reason: 'New info supersedes old' })
    });
    const result = await detector.check({ title: 'Switched to pattern Y', narrative: 'X is deprecated' });
    expect(result.decision).toBe('INVALIDATE');
    expect(result.targetId).toBe(42);
  });

  it('returns ADD when similar but not conflicting', async () => {
    const detector = new ConflictDetector({
      fetchSimilar: async () => [{ id: 1, title: 'Related thing', narrative: 'tangential' }],
      llm: async () => ({ decision: 'ADD' as const })
    });
    const result = await detector.check({ title: 'New aspect', narrative: 'different angle' });
    expect(result.decision).toBe('ADD');
  });

  it('defaults to ADD if LLM call fails', async () => {
    const detector = new ConflictDetector({
      fetchSimilar: async () => [{ id: 1, title: 'Something', narrative: 'info' }],
      llm: async () => { throw new Error('LLM unavailable'); }
    });
    const result = await detector.check({ title: 'New thing', narrative: 'details' });
    expect(result.decision).toBe('ADD');
  });
});
```

Run: `bun test tests/services/sync/ConflictDetector.test.ts`
Expected: FAIL (file doesn't exist)

- [ ] **Step 2: Implement `ConflictDetector`**

Create `src/services/sync/ConflictDetector.ts`:

```typescript
import { logger } from '../../utils/logger.js';

export type ConflictDecision = 'ADD' | 'UPDATE' | 'INVALIDATE' | 'NOOP';

export interface SimilarObservation {
  id: number;
  title: string | null;
  narrative?: string | null;
  agent_name?: string;
  git_branch?: string | null;
}

export interface ConflictCheckResult {
  decision: ConflictDecision;
  targetId?: number;
  reason?: string;
}

export interface ConflictDetectorConfig {
  fetchSimilar: (obs: { title: string; narrative?: string }) => Promise<SimilarObservation[]>;
  // Injected from worker-service.ts — routes through CLAUDE_MEM_PROVIDER (claude/gemini/openrouter)
  // Accepts the full prompt, returns the raw LLM text response
  llm?: (prompt: string) => Promise<string>;
  enabled?: boolean;
}

function buildPrompt(obs: { title: string; narrative?: string }, similar: SimilarObservation[]): string {
  return `You are a memory conflict resolver for a shared AI coding assistant knowledge base.

A new observation is about to be stored:
TITLE: ${obs.title}
NARRATIVE: ${obs.narrative || '(none)'}

Most semantically similar existing observations:
${similar.map((s, i) => `[${i + 1}] ID:${s.id} | Agent:${s.agent_name || 'unknown'} | Branch:${s.git_branch || 'unknown'}
    TITLE: ${s.title}
    NARRATIVE: ${s.narrative || '(none)'}`).join('\n\n')}

Decide what to do. Choose ONE:
- ADD: New information, no conflict. Store it.
- UPDATE: Supersedes an existing one. Store new, invalidate old (provide targetId).
- INVALIDATE: Contradicts an existing one that appears wrong. Invalidate old, add new (provide targetId).
- NOOP: Duplicate or adds no value. Skip.

Respond ONLY with JSON: {"decision": "ADD"|"UPDATE"|"INVALIDATE"|"NOOP", "targetId": <number or null>, "reason": "<brief>"}`;
}

export class ConflictDetector {
  private config: ConflictDetectorConfig;

  constructor(config: ConflictDetectorConfig) {
    this.config = config;
    if (!config.llm) {
      logger.warn('CONFLICT', 'No LLM provider injected — conflict detection disabled. Pass llm via ConflictDetectorConfig.');
    }
  }

  async check(obs: { title: string; narrative?: string }): Promise<ConflictCheckResult> {
    if (this.config.enabled === false || !this.config.llm) return { decision: 'ADD' };

    try {
      const similar = await this.config.fetchSimilar(obs);
      if (similar.length === 0) return { decision: 'ADD' };

      const prompt = buildPrompt(obs, similar);
      const text = await this.config.llm(prompt);

      const match = text.match(/\{[\s\S]*?\}/);
      if (!match) return { decision: 'ADD' };
      return JSON.parse(match[0]) as ConflictCheckResult;
    } catch (err) {
      logger.debug('CONFLICT', 'Conflict detection failed, defaulting to ADD', {}, err as Error);
      return { decision: 'ADD' };
    }
  }
}

// NOTE for worker-service.ts wiring:
// The llm function should call the active provider's simple completion method.
// Example using GeminiAgent or SDKAgent's underlying client — just return raw text:
//
//   llm: async (prompt) => {
//     if (isGeminiSelected()) return geminiAgent.complete(prompt);
//     if (isOpenRouterSelected()) return openRouterAgent.complete(prompt);
//     return sdkAgent.complete(prompt); // Claude
//   }
//
// Each agent needs a lightweight complete(prompt: string): Promise<string> method added.
// Use CLAUDE_MEM_TIER_SIMPLE_MODEL (or equivalent) to pick the cheapest model for this task.
```

- [ ] **Step 3: Run tests**

Run: `bun test tests/services/sync/ConflictDetector.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 4: Commit**

```bash
git add src/services/sync/ConflictDetector.ts tests/services/sync/ConflictDetector.test.ts
git commit -m "feat: add ConflictDetector — LLM-based ADD/UPDATE/INVALIDATE/NOOP classification"
```

---

## Task 3: Add `fetchSimilar` and `pushInvalidations` to SyncClient

**Files:**
- Modify: `src/services/sync/SyncClient.ts`

- [ ] **Step 1: Add methods to `SyncClient.ts`**

After the existing `searchTeam()` method, add:

```typescript
async fetchSimilar(title: string, limit = 5): Promise<SimilarObservation[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
  try {
    const url = new URL(this.buildUrl('/api/search'));
    url.searchParams.set('q', title);
    url.searchParams.set('limit', String(limit));
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: this.buildHeaders(),
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const data = await response.json() as { results?: SimilarObservation[] };
    return data.results || [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async pushInvalidations(ids: number[]): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
  try {
    await fetch(this.buildUrl('/api/sync/invalidate'), {
      method: 'POST',
      headers: { ...this.buildHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
      signal: controller.signal,
    });
  } catch {
    logger.debug('CONFLICT', 'Failed to push invalidations to remote');
  } finally {
    clearTimeout(timeout);
  }
}
```

Also import `SimilarObservation` from `ConflictDetector.ts` at the top of the file.

- [ ] **Step 2: Commit**

```bash
git add src/services/sync/SyncClient.ts
git commit -m "feat: add fetchSimilar and pushInvalidations to SyncClient"
```

---

## Task 4: Wire ConflictDetector into SyncWorker

**Files:**
- Modify: `src/services/sync/SyncWorker.ts`

Before the existing push logic in `tick()`, run conflict detection on each pending observation.

- [ ] **Step 1: Add conflict check method to SyncWorker**

In `src/services/sync/SyncWorker.ts`, import `ConflictDetector` and add:

```typescript
import { ConflictDetector } from './ConflictDetector.js';

// Add private field:
private detector: ConflictDetector | null = null;

// In the method that initializes the sync client (after syncClient is available):
this.detector = new ConflictDetector({
  fetchSimilar: (obs) => this.syncClient.fetchSimilar(obs.title || ''),
  enabled: true,
});

// New method:
private async processConflicts(observations: any[]): Promise<any[]> {
  if (!this.detector) return observations;
  const toInvalidate: number[] = [];
  const filtered: any[] = [];

  for (const obs of observations) {
    if (!obs.title) { filtered.push(obs); continue; }

    const result = await this.detector.check({
      title: obs.title,
      narrative: obs.narrative || undefined,
    });

    logger.debug('CONFLICT', `Obs "${obs.title}" → ${result.decision}${result.targetId ? ` (invalidates #${result.targetId})` : ''}`);

    if (result.decision === 'NOOP') continue; // skip duplicate

    if ((result.decision === 'INVALIDATE' || result.decision === 'UPDATE') && result.targetId) {
      toInvalidate.push(result.targetId);
    }

    filtered.push(obs);
  }

  if (toInvalidate.length > 0) {
    await this.syncClient.pushInvalidations(toInvalidate);
    logger.info('CONFLICT', `Invalidated ${toInvalidate.length} remote observation(s): ${toInvalidate.join(', ')}`);
  }

  return filtered;
}
```

- [ ] **Step 2: Call `processConflicts` in the tick/push flow**

Find where `tick()` builds and sends the payload. Before the push call, add:

```typescript
payload.observations = await this.processConflicts(payload.observations);
```

- [ ] **Step 3: Commit**

```bash
git add src/services/sync/SyncWorker.ts
git commit -m "feat: wire ConflictDetector into SyncWorker pre-push pipeline"
```

---

## Task 5: Add Invalidation Endpoint to Vercel API + Supabase Migration

**Files:**
- Create: `api/sync/invalidate.ts`
- Modify: `api/lib/SupabaseManager.ts`
- Create: `supabase/migrations/003_add_provenance_columns.sql`

- [ ] **Step 1: Create Supabase migration**

Create `supabase/migrations/003_add_provenance_columns.sql`:

```sql
ALTER TABLE observations ADD COLUMN IF NOT EXISTS git_branch TEXT;
ALTER TABLE observations ADD COLUMN IF NOT EXISTS invalidated_at BIGINT;
ALTER TABLE observations ADD COLUMN IF NOT EXISTS validation_status TEXT DEFAULT 'unvalidated';

CREATE INDEX IF NOT EXISTS idx_obs_validation ON observations(validation_status);
CREATE INDEX IF NOT EXISTS idx_obs_invalidated ON observations(invalidated_at);
```

Run: `supabase db push`

- [ ] **Step 2: Add `invalidateObservations` to SupabaseManager**

In `api/lib/SupabaseManager.ts`, add to the class:

```typescript
async invalidateObservations(localIds: number[], agentId: string): Promise<void> {
  const { error } = await this.supabase
    .from('observations')
    .update({
      invalidated_at: Date.now(),
      validation_status: 'invalidated',
    })
    .in('local_id', localIds)
    .eq('agent_id', agentId);

  if (error) throw error;
}
```

- [ ] **Step 3: Create `api/sync/invalidate.ts`**

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initSupabase } from '../lib/SupabaseManager.js';
import { authenticateRequest } from '../auth.js';

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

  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'ids array required' });
    return;
  }

  try {
    const db = await initSupabase(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
    await db.invalidateObservations(ids, auth.agentId);
    res.status(200).json({ invalidated: ids.length });
  } catch (err: any) {
    res.status(500).json({ error: 'Invalidation failed', detail: err?.message });
  }
}
```

- [ ] **Step 4: Filter invalidated from search results**

In `api/lib/SupabaseManager.ts`, in `searchObservations()`, add a filter to exclude invalidated:

```typescript
// Add to the query chain:
.is('invalidated_at', null)
```

- [ ] **Step 5: Commit and deploy**

```bash
git add api/sync/invalidate.ts api/lib/SupabaseManager.ts supabase/migrations/003_add_provenance_columns.sql
git commit -m "feat: add invalidation endpoint, Supabase migration, filter invalidated from search"
vercel --prod
```

---

## Task 6: Filter Invalidated from Local Context Injection

**Files:**
- Modify: `src/services/sqlite/SessionStore.ts`
- Modify: `src/services/worker/SearchManager.ts`

- [ ] **Step 1: Filter invalidated from local observation queries**

In `SessionStore.ts`, find all queries that fetch observations for context injection (look for methods called by `/api/context/inject`). Add to each:

```sql
AND (invalidated_at IS NULL OR invalidated_at = 0)
```

- [ ] **Step 2: Flag unvalidated team results in SearchManager**

In `src/services/worker/SearchManager.ts`, in the team merge block, enrich observations with an `unvalidated` flag:

```typescript
observations.push({
  ...obs,
  source: 'team' as const,
  agent_name: obs.agent_name,
  unvalidated: obs.validation_status === 'unvalidated',
});
```

- [ ] **Step 3: Commit**

```bash
git add src/services/sqlite/SessionStore.ts src/services/worker/SearchManager.ts
git commit -m "feat: filter invalidated from context injection; flag unvalidated team results"
```

---

## Task 7: Build, Sync, and Smoke Test

- [ ] **Step 1: Full build**

```bash
npm run build-and-sync
```

Expected: clean build, worker restarts

- [ ] **Step 2: Run all tests**

```bash
bun test
```

Expected: all passing

- [ ] **Step 3: Smoke test conflict detection**

```bash
# Watch for CONFLICT log entries after a few tool uses in Claude Code:
tail -f ~/.engram/logs/claude-mem-$(date +%Y-%m-%d).log | grep CONFLICT
```

Expected: `CONFLICT` entries showing decision per new observation (most will be ADD)

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: memory quality feature complete — conflict detection, provenance, temporal retention"
```

---

## What This Delivers

| Problem | Solution |
|---------|----------|
| Wrong-premise observations polluting shared brain | ConflictDetector invalidates contradicting observations before sync |
| No way to audit where bad data came from | `git_branch` + `agent_name` on every observation |
| Deleted memories lose historical context | `invalidated_at` preserves history, never hard-deletes |
| Unmerged branch data treated as ground truth | `validation_status: unvalidated` flagged in retrieval |
| Silent conflicts with no logging | LLM classifier logs every decision |

## What This Does NOT Solve (Future Work)

- Automatic promotion from `unvalidated` → `validated` when a PR merges (needs GitHub webhook)
- Confidence scoring at write time (no industry consensus yet)
- Multi-hop contradiction chains (unsolved problem industry-wide)
