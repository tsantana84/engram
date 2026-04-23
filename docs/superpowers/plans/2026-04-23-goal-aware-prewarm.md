# Goal-Aware Session Prewarm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the wall-of-history context injection with a compact 500-token directive briefing composed from 4 targeted sources, injected at both SessionStart (static) and UserPromptSubmit (LLM-composed, goal-aware).

**Architecture:** New `BriefingComposer.ts` queries session_summaries.next_steps, corrections, and observations type='decision', formats as imperative directives. At SessionStart, static template (no LLM, <50ms). At UserPromptSubmit, LLM composes a goal-aware version using the actual user prompt. Existing observation timeline is preserved below the briefing. Existing correctionsBlock in ContextBuilder is removed (superseded).

**Tech Stack:** TypeScript, Bun/SQLite (`bun:sqlite`), existing `buildLearningLlmClosure` for LLM wiring.

**Spec:** `docs/superpowers/specs/2026-04-23-goal-aware-prewarm-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/services/context/BriefingComposer.ts` | 4 SQL queries + static template + LLM-composed briefing |
| Create | `src/services/context/__tests__/BriefingComposer.test.ts` | Unit + integration tests |
| Modify | `src/services/context/ContextBuilder.ts:33-75, 220-229` | Remove correctionsBlock helpers, add buildSessionBriefing call |
| Modify | `src/cli/handlers/session-init.ts:147-176` | Add buildPromptBriefing call, prepend to additionalContext |

**Build after all tasks:** `npm run build-and-sync`

---

## Task 1: BriefingComposer — Data Layer + Static Template

**Files:**
- Create: `src/services/context/BriefingComposer.ts`
- Create: `src/services/context/__tests__/BriefingComposer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/services/context/__tests__/BriefingComposer.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../../sqlite/SessionStore.js';
import { buildSessionBriefing } from '../BriefingComposer.js';

function seedData(store: SessionStore) {
  // Insert a sdk_session so session_summaries FK works
  store.db.prepare(`
    INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch)
    VALUES ('cs-1', 'ms-1', '/test/proj', datetime('now'), ?)
  `).run(Date.now());

  store.db.prepare(`
    INSERT INTO session_summaries (memory_session_id, project, next_steps, completed, created_at, created_at_epoch)
    VALUES ('ms-1', '/test/proj', 'Finish the auth migration', 'Set up DB schema', datetime('now'), ?)
  `).run(Date.now());

  store.db.prepare(`
    INSERT INTO corrections (tried, wrong_because, fix, trigger_context, project, created_at)
    VALUES ('use rm -rf', 'deletes permanently', 'use trash-put', 'deleting files', '/test/proj', ?)
  `).run(Date.now());

  // Observation with type=decision needs a session
  const sessionRow = store.db.prepare(
    "SELECT memory_session_id FROM sdk_sessions WHERE project = ? LIMIT 1"
  ).get('/test/proj') as any;
  store.db.prepare(`
    INSERT INTO observations (memory_session_id, project, type, title, narrative, created_at, created_at_epoch, discovery_tokens)
    VALUES (?, '/test/proj', 'decision', 'Use SQLite not Postgres', 'We decided SQLite because simpler', datetime('now'), ?, 0)
  `).run(sessionRow.memory_session_id, Date.now());
}

describe('buildSessionBriefing', () => {
  let store: SessionStore;
  beforeEach(() => { store = new SessionStore(':memory:'); });
  afterEach(() => { store.close(); });

  it('returns empty string for fresh project (no data)', () => {
    expect(buildSessionBriefing(store, '/empty/proj')).toBe('');
  });

  it('returns briefing string when data exists', () => {
    seedData(store);
    const result = buildSessionBriefing(store, '/test/proj');
    expect(result).toContain('AGENT BRIEFING');
  });

  it('includes last session next_steps', () => {
    seedData(store);
    const result = buildSessionBriefing(store, '/test/proj');
    expect(result).toContain('Finish the auth migration');
  });

  it('includes corrections in Watch out section', () => {
    seedData(store);
    const result = buildSessionBriefing(store, '/test/proj');
    expect(result).toContain('Watch out');
    expect(result).toContain('rm -rf');
    expect(result).toContain('trash-put');
  });

  it('includes decisions', () => {
    seedData(store);
    const result = buildSessionBriefing(store, '/test/proj');
    expect(result).toContain('Use SQLite not Postgres');
  });

  it('excludes sections for other projects', () => {
    seedData(store);
    const result = buildSessionBriefing(store, '/other/proj');
    expect(result).toBe('');
  });

  it('omits Watch out section when no corrections', () => {
    // Insert only summary, no corrections
    store.db.prepare(`
      INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch)
      VALUES ('cs-2', 'ms-2', '/proj2', datetime('now'), ?)
    `).run(Date.now());
    store.db.prepare(`
      INSERT INTO session_summaries (memory_session_id, project, next_steps, created_at, created_at_epoch)
      VALUES ('ms-2', '/proj2', 'Do X next', datetime('now'), ?)
    `).run(Date.now());

    const result = buildSessionBriefing(store, '/proj2');
    expect(result).not.toContain('Watch out');
    expect(result).toContain('Do X next');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd /Users/thiagosantana/projects/cint/engram
bun test src/services/context/__tests__/BriefingComposer.test.ts
```

Expected: FAIL with "Cannot find module '../BriefingComposer.js'"

**Note:** `new SessionStore(':memory:')` auto-runs ALL migrations in the constructor. This means `title`, `narrative`, `discovery_tokens` columns exist on `observations`, and `session_summaries` has no UNIQUE constraint on `memory_session_id` (migration 7 removes it). The seed data is valid as written.

- [ ] **Step 3: Implement BriefingComposer.ts**

```typescript
// src/services/context/BriefingComposer.ts
import { logger } from '../../utils/logger.js';
import type { SessionStore } from '../sqlite/SessionStore.js';

const CHARS_PER_TOKEN = 4;
const MAX_CHARS = 2000; // ~500 tokens

interface SessionSummaryRow { next_steps: string | null; completed: string | null; }
interface CorrectionRow { tried: string; wrong_because: string; fix: string; trigger_context: string; }
interface DecisionRow { title: string | null; narrative: string | null; }

function queryLastSummary(db: SessionStore, project: string): SessionSummaryRow | null {
  try {
    return db.db.prepare(`
      SELECT next_steps, completed FROM session_summaries
      WHERE project = ? ORDER BY created_at_epoch DESC LIMIT 1
    `).get(project) as SessionSummaryRow | null;
  } catch { return null; }
}

function queryRecentCorrections(db: SessionStore, project: string): CorrectionRow[] {
  try {
    return db.db.prepare(`
      SELECT tried, wrong_because, fix, trigger_context FROM corrections
      WHERE project = ? AND trigger_context != ''
      ORDER BY created_at DESC LIMIT 3
    `).all(project) as CorrectionRow[];
  } catch { return []; }
}

function queryRecentDecisions(db: SessionStore, project: string): DecisionRow[] {
  try {
    return db.db.prepare(`
      SELECT title, narrative FROM observations
      WHERE project = ? AND type = 'decision'
      ORDER BY created_at_epoch DESC LIMIT 5
    `).all(project) as DecisionRow[];
  } catch { return []; }
}

function buildTemplate(
  summary: SessionSummaryRow | null,
  corrections: CorrectionRow[],
  decisions: DecisionRow[]
): string {
  const sections: string[] = ['## AGENT BRIEFING'];

  if (summary?.next_steps || summary?.completed) {
    const parts: string[] = [];
    if (summary.completed) parts.push(`Completed: ${summary.completed}`);
    if (summary.next_steps) parts.push(`Next: ${summary.next_steps}`);
    sections.push(`**Last session:** ${parts.join('. ')}`);
  }

  if (corrections.length > 0) {
    const lines = corrections.map(c =>
      `- Tried: ${c.tried}. Wrong because: ${c.wrong_because}. Fix: ${c.fix}. [Context: ${c.trigger_context}]`
    );
    sections.push(`**Watch out:**\n${lines.join('\n')}`);
  }

  if (decisions.length > 0) {
    const lines = decisions.map(d => `- ${d.title ?? d.narrative ?? ''}`.slice(0, 120));
    sections.push(`**Decisions made:**\n${lines.join('\n')}`);
  }

  if (sections.length === 1) return ''; // only header — nothing to show
  sections.push('---');
  return sections.join('\n\n');
}

export function buildSessionBriefing(db: SessionStore, project: string): string {
  const summary = queryLastSummary(db, project);
  const corrections = queryRecentCorrections(db, project);
  const decisions = queryRecentDecisions(db, project);

  const text = buildTemplate(summary, corrections, decisions);
  return text.slice(0, MAX_CHARS);
}

const LLM_PROMPT = (userPrompt: string, sources: string) =>
  `You are writing a briefing for an AI coding agent about to start work.

The agent's task: "${userPrompt}"

Available context from past sessions:
${sources}

Write a briefing of ≤400 tokens. Rules:
- Use imperative voice ("Watch out for X", "You decided Y", "Next step is Z")
- Include ONLY what's relevant to the agent's task above
- Omit irrelevant sections entirely
- Keep it tight — the agent will read every word
- Do NOT include a header line

Output only the briefing text, no preamble.`;

export async function buildPromptBriefing(
  db: SessionStore,
  project: string,
  userPrompt: string,
  llm: (prompt: string) => Promise<string>
): Promise<string> {
  const staticFallback = buildSessionBriefing(db, project);
  if (!staticFallback) return '';

  try {
    const raw = await llm(LLM_PROMPT(userPrompt, staticFallback));
    const result = '## AGENT BRIEFING\n\n' + raw.trim() + '\n\n---';
    return result.slice(0, MAX_CHARS);
  } catch (err) {
    logger.debug('BRIEFING', 'LLM composition failed, using static fallback', {}, err as Error);
    return staticFallback;
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
bun test src/services/context/__tests__/BriefingComposer.test.ts
```

Expected: 7/7 PASS

- [ ] **Step 5: Run full suite — no regressions**

```bash
bun test --timeout 30000 2>&1 | tail -8
```

Expected: same pass count + 7 new, same 5 pre-existing failures

- [ ] **Step 6: Commit**

```bash
git add src/services/context/BriefingComposer.ts src/services/context/__tests__/BriefingComposer.test.ts
git commit -m "feat(prewarm): add BriefingComposer with 4-source directive briefing"
```

---

## Task 2: Wire BriefingComposer into ContextBuilder (SessionStart)

**Files:**
- Modify: `src/services/context/ContextBuilder.ts`

This task:
1. Imports `buildSessionBriefing` from BriefingComposer
2. Removes the existing `queryCorrections`, `scoreCorrections`, `renderCorrectionsBlock` helpers + `CorrectionPrewarm` interface (superseded)
3. Calls `buildSessionBriefing` and prepends to output
4. Adds a test that verifies the briefing is prepended

- [ ] **Step 1: Read the current file**

Read `src/services/context/ContextBuilder.ts` to confirm:
- Lines 33-75: the corrections helpers to remove
- Line ~225: `return correctionsBlock + output;`

```bash
grep -n "correctionsBlock\|queryCorrections\|scoreCorrections\|renderCorrections\|CorrectionPrewarm\|buildSessionBriefing" \
  /Users/thiagosantana/projects/cint/engram/src/services/context/ContextBuilder.ts
```

- [ ] **Step 2: Write failing test**

```typescript
// Add to src/services/context/__tests__/BriefingComposer.test.ts:

import { generateContext } from '../ContextBuilder.js';

describe('generateContext briefing integration', () => {
  it('returns empty string for project with no data (no crash)', async () => {
    // This tests the graceful empty-state path
    const result = await generateContext({ cwd: '/nonexistent/project/xyz' });
    // Should return empty state or empty string, not throw
    expect(typeof result).toBe('string');
  });
});
```

Actually, generateContext is hard to test in isolation (opens real DB). Instead write a simpler integration check:

```typescript
// Verify buildSessionBriefing is exported from ContextBuilder's module (indirect check)
// Just run the existing BriefingComposer tests — they cover the same logic
```

Skip a separate test here — the BriefingComposer tests cover the logic. The integration is verified by the build + smoke test in Task 4.

- [ ] **Step 3: Add import to ContextBuilder.ts**

At the top of `src/services/context/ContextBuilder.ts`, after existing imports, add:
```typescript
import { buildSessionBriefing } from './BriefingComposer.js';
```

- [ ] **Step 4: Remove corrections helpers**

Remove these blocks from ContextBuilder.ts (lines ~33-75):
- `interface CorrectionPrewarm { ... }`
- `function queryCorrections(...) { ... }`
- `function scoreCorrections(...) { ... }`
- `function renderCorrectionsBlock(...) { ... }`

These are now handled by BriefingComposer. Confirm with grep before deleting.

- [ ] **Step 5: Replace correctionsBlock logic in generateContext**

Find and replace in `generateContext()`:

**Remove** (approximately lines 218-222):
```typescript
// Corrections prewarm: query project-scoped corrections, score against session goal
const allCorrections = queryCorrections(db, project);
const correctionGoal = observations[0]?.title ?? '';
const prewarmCorrections = scoreCorrections(allCorrections, correctionGoal);
const correctionsBlock = renderCorrectionsBlock(prewarmCorrections);
```

**Remove** from return (line ~228):
```typescript
return correctionsBlock + output;
```

**Add** after `const db = initializeDatabase();` succeeds (before observations query):
```typescript
const briefing = buildSessionBriefing(db, project);
```

**Change** return to:
```typescript
return briefing ? briefing + '\n\n' + output : output;
```

Also handle the empty-state path — if empty state is returned early, briefing won't be included. That's fine (fresh project = no briefing).

- [ ] **Step 6: Run full suite**

```bash
bun test --timeout 30000 2>&1 | tail -8
```

Expected: no regressions, TypeScript should compile without errors about missing functions

- [ ] **Step 7: Commit**

```bash
git add src/services/context/ContextBuilder.ts
git commit -m "feat(prewarm): wire BriefingComposer into SessionStart context generation"
```

---

## Task 3: Wire buildPromptBriefing into session-init (UserPromptSubmit)

**Files:**
- Modify: `src/cli/handlers/session-init.ts`

The handler already builds `additionalContext` from semantic search results around lines 147-163. We prepend the LLM briefing to it.

- [ ] **Step 1: Read the injection area**

Read `src/cli/handlers/session-init.ts` lines 1-30 and 140-176:

```bash
sed -n '1,30p' /Users/thiagosantana/projects/cint/engram/src/cli/handlers/session-init.ts
sed -n '140,176p' /Users/thiagosantana/projects/cint/engram/src/cli/handlers/session-init.ts
```

Confirm:
- Where `additionalContext` is set (around line 163)
- Where `hookSpecificOutput` is returned (around line 167-176)
- Where settings are loaded (around line 35)
- The exact variable name for the user prompt (look for `prompt` or `userPrompt` in the POST body)

- [ ] **Step 2: Write a gate test for the regex check**

The heuristic gate already exists for corrections. For prewarm briefing, we always run (no gate) — just cap at 2s timeout.

No new unit test needed here — the BriefingComposer tests cover the logic. Integration verified in Task 4.

- [ ] **Step 3: Add imports to session-init.ts**

Add to imports at top of `src/cli/handlers/session-init.ts`:

```typescript
import { buildPromptBriefing } from '../services/context/BriefingComposer.js';
import { buildLearningLlmClosure } from '../services/worker-service.js';
import { SessionStore } from '../services/sqlite/SessionStore.js';
```

**Note:** `buildLearningLlmClosure` is already imported if correction gate uses it — check first with `grep -n "buildLearningLlmClosure" src/cli/handlers/session-init.ts`. If already imported, skip.

- [ ] **Step 4: Add briefing construction before the return**

Find the section around lines 147-176 where `additionalContext` is built and returned. After `additionalContext` is set (or after the semantic search block), add:

```typescript
// Build goal-aware briefing from past sessions/corrections/decisions
let prewarmBriefing = '';
try {
  const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
  const learningModel = settings.CLAUDE_MEM_LEARNING_LLM_MODEL ?? 'claude-haiku-4-5-20251001';
  const learningProvider = (settings.CLAUDE_MEM_LEARNING_LLM_PROVIDER ?? 'anthropic') as 'anthropic' | 'openai';
  const learningApiKey = settings.CLAUDE_MEM_ANTHROPIC_API_KEY ?? settings.CLAUDE_MEM_OPENAI_API_KEY;
  const llm = buildLearningLlmClosure(learningModel, learningProvider, learningApiKey);
  const db = new SessionStore();
  try {
    prewarmBriefing = await buildPromptBriefing(db, project, prompt, llm);
  } finally {
    db.close();
  }
} catch (err) {
  // Silently skip — prewarm is best-effort
}
```

Then, when building the return value, prepend `prewarmBriefing` to `additionalContext`:

```typescript
const finalContext = [prewarmBriefing, additionalContext].filter(Boolean).join('\n\n');

if (finalContext) {
  return {
    continue: true,
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: finalContext,
    },
  };
}
return { continue: true, suppressOutput: true };
```

**Important:** Check the exact shape of the existing return — the existing code may already have this pattern. Adapt rather than duplicate. Do NOT change the existing `{ continue: true, suppressOutput: true }` fallback shape.

**Also check:** what variable holds the user's prompt text. From the research, the POST body sends `prompt` — look for how it's read from `initResult` or `req.body`. Use the same variable.

- [ ] **Step 5: Build**

```bash
npm run build-and-sync
```

Expected: clean build, worker restarts

- [ ] **Step 6: Verify injection works**

In a new Claude Code session on the engram project, check the first message context. The `## AGENT BRIEFING` block should appear before the observation timeline.

Alternatively, check logs:
```bash
tail -f ~/.engram/logs/engram-$(date +%Y-%m-%d).log | grep -i "briefing\|prewarm"
```

- [ ] **Step 7: Run full suite**

```bash
bun test --timeout 30000 2>&1 | tail -8
```

Expected: no regressions

- [ ] **Step 8: Commit**

```bash
git add src/cli/handlers/session-init.ts
git commit -m "feat(prewarm): inject goal-aware briefing at UserPromptSubmit"
```

---

## Task 4: ROADMAP + Final Verification

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Mark Goal-Aware Session Prewarm as shipped in ROADMAP.md**

Update the P1 entry to reflect what was built:

```markdown
### P1 — Goal-Aware Session Prewarm ✅
Compact 500-token directive briefing from 4 sources (last session next_steps, corrections, decisions) injected at SessionStart (static template) and UserPromptSubmit (LLM-composed, goal-aware). Format: imperative directives ("Watch out:", "Decisions made:") not history log. Supersedes old corrections-only prewarm.
```

- [ ] **Step 2: Run final test suite**

```bash
bun test --timeout 30000 2>&1 | tail -10
```

Expected: ≥1567 pass, 5 pre-existing failures, 0 new failures

- [ ] **Step 3: Build and sync**

```bash
npm run build-and-sync
```

- [ ] **Step 4: Smoke test end-to-end**

Start a new Claude Code session in the engram project. The prewarm should inject a briefing. Check the session context in the viewer UI at http://localhost:37777 — look for a session where the first observation shows the briefing was received.

- [ ] **Step 5: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: mark Goal-Aware Session Prewarm as complete in roadmap"
```

- [ ] **Step 6: Push**

```bash
git push
```

---

## Notes for Implementer

**Key gotchas:**

1. `session-init.ts` already uses `SettingsDefaultsManager` — check if the import + variable already exists before adding. The correction gate (Task 5 of previous feature) already wires `buildLearningLlmClosure` in `SessionRoutes.ts` — session-init.ts may not have it yet.

2. `buildPromptBriefing` opens a new `SessionStore()` connection. The handler may already have a DB connection via the HTTP calls — using a fresh local connection is fine but close it in `finally`.

3. The `project` variable in session-init.ts is obtained via `getProjectName(cwd)` — same as ContextBuilder. Confirm the variable name before referencing it.

4. If `additionalContext` is undefined (semantic search disabled), `[prewarmBriefing, undefined].filter(Boolean)` works correctly — only prewarmBriefing will be included.

5. The LLM call in `buildPromptBriefing` has no explicit timeout. If the LLM hangs, the hook's 60s timeout saves us. The try/catch with silent fallback handles all other errors.
