# Amnesia Recovery Protocol — Design

**Status:** Draft
**Date:** 2026-04-21
**Owner:** Thiago Santana
**Feature flag:** `CLAUDE_MEM_AMNESIA_RECOVERY_ENABLED` (default off)

## Problem

Claude Code compresses context when it approaches token limits. Post-compaction, Claude loses most of the working state — active task, open decisions, files in play, recent errors. Users must re-explain what they were doing. This breaks flow on long sessions and is the single largest source of wasted tokens on resume.

Engram already sits at the hook layer and has persistent memory. It can detect compaction and inject a targeted briefing so Claude wakes up with full context without user intervention.

## Goal

When Claude Code compacts context, automatically generate a ≤500-token briefing capturing the active task, open todos, recent file edits, recent decisions, and current blockers. Inject that briefing at the next `SessionStart` event so Claude resumes work coherently.

## Non-goals

- Cross-session resume (yesterday's context). Scope is per-session compaction only.
- Replacing the existing `SessionStart` context handler. Briefing prepends to it.
- Manual "force resume" UX. POC is compaction-triggered only.

## Architecture

Two new hook handlers + one generator + one storage table. Feature-flagged.

```
┌─ PreCompact hook ──────┐      ┌─ SessionStart hook ────┐
│  capturePreCompact()   │      │  injectBriefing()       │
│  → BriefingGenerator   │      │  → read session_briefings│
│  → SQLite insert       │      │  → prepend to context   │
└────────────────────────┘      └─────────────────────────┘
           │                                │
           └──→ session_briefings (SQLite) ─┘
```

Gated by `CLAUDE_MEM_AMNESIA_RECOVERY_ENABLED=true`. Off by default.

### Components

- **PreCompact handler** — `src/cli/handlers/pre-compact.ts`. New event type `pre-compact` wired in `handlers/index.ts`. Invoked by Claude Code via `.claude/settings.json` hook config.
- **SessionStart injection** — extend existing `src/cli/handlers/context.ts`. Check for pending briefing before returning normal context.
- **BriefingGenerator** — `src/services/briefing/BriefingGenerator.ts`. Hybrid template + LLM. Injectable `llm` abstraction, same pattern as `ConflictDetector` / `LearningExtractor`.
- **Briefing repo** — SQLite CRUD helpers for `session_briefings`.
- **Worker endpoints** — `POST /api/briefings/generate`, `GET /api/briefings/pending`.

## Data Model

New table (migration version 28, next after current 27):

```sql
CREATE TABLE session_briefings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT NOT NULL,
  project         TEXT NOT NULL,
  briefing_md     TEXT NOT NULL,
  token_estimate  INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,  -- unix ms, PreCompact time
  consumed_at     INTEGER,           -- unix ms, SessionStart injection time (NULL = unconsumed)
  trigger         TEXT NOT NULL      -- 'pre_compact' (future: 'manual', 'periodic')
);

CREATE INDEX idx_briefings_session ON session_briefings(session_id, consumed_at);
CREATE INDEX idx_briefings_project ON session_briefings(project, created_at DESC);
```

Lookup: `SELECT ... WHERE session_id = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`.
On injection: `UPDATE ... SET consumed_at = ?`. Rows retained for audit and viewer rendering.

## PreCompact Handler

Flow:

```
1. Read input: { session_id, transcript_path, cwd }
2. Flag check: if !CLAUDE_MEM_AMNESIA_RECOVERY_ENABLED → exit 0 silently
3. Project filter: if cwd in excluded projects → exit 0
4. Call worker: POST /api/briefings/generate
   Body: { session_id, project, transcript_path }
5. Timeout: 8s hard cap. On failure → exit 0 (never block compaction)
6. Exit 0
```

Worker endpoint `POST /api/briefings/generate`:

```
1. Read transcript_path (Claude Code writes full transcript before PreCompact)
2. Query SQLite for session context:
   - recent observations (session_id, last 20)
   - open todos (from TodoWrite observations if present)
   - recent file edits (last 10 from observations)
   - recent decisions (observations tagged as decision)
3. BriefingGenerator.generate(context) → markdown
4. INSERT into session_briefings
5. Return 200 {briefing_id, token_estimate}
```

Hook never blocks compaction. If anything fails, compaction proceeds normally; session resumes without briefing (falls back to existing context handler).

## BriefingGenerator

Hybrid template + LLM.

Input type:

```ts
type BriefingContext = {
  sessionId: string;
  project: string;
  transcript: string;              // last ~6000 chars from transcript_path
  recentObservations: Observation[];
  recentFileEdits: FileEdit[];
  openTodos: Todo[];
  recentDecisions: Observation[];
};
```

Output: markdown string, target ≤500 tokens.

Pipeline:

### Template section (deterministic, ~300 tokens)

```markdown
## Resuming Session
**Project:** {project}
**Active files:** {last 5 edited paths}
**Open todos:** {bulleted list, max 10}
**Recent decisions:** {bulleted list, max 5}
**Recent errors/blockers:** {extracted from last 10 observations matching error patterns}
```

### LLM section ("Active Task Summary", ~150 tokens)

Prompt:
> "In 2-3 sentences, summarize what the user and assistant were actively working on based on this transcript tail. Focus on: current goal, last action taken, next intended step."

Input: last 6000 chars of transcript.
Output: prepended as `## Active Task` heading.

### Merge

Single markdown doc. Token count via tiktoken estimate. If total >500 tokens, truncate template sections (drop oldest decisions first, then oldest file edits). Never truncate LLM summary.

### LLM provider

Reuse existing `llm: (prompt) => Promise<string>` abstraction from worker service. Testable with stub.

### Fallbacks

- LLM timeout/failure → template-only briefing stored. Still usable.
- Transcript unreadable → template-only briefing, log warn.
- Template alone >400 tokens → truncate before LLM call.

## SessionStart Injection

Extend existing `src/cli/handlers/context.ts`.

Flow:

```
1. Flag check: if !CLAUDE_MEM_AMNESIA_RECOVERY_ENABLED → skip, fall through
2. Worker call: GET /api/briefings/pending?session_id={sessionId}
3. If briefing found:
   a. Prepend briefing_md to context output with marker:
      ---
      ## 🧠 Session Resumed (Amnesia Recovery)
      {briefing_md}
      ---
   b. Worker marks briefing consumed (UPDATE consumed_at atomically)
4. If no briefing → existing context handler path unchanged
```

Claude Code concatenates SessionStart handler output into new session context. No separate injection mechanism needed.

**Ordering:** briefing goes first (top of context), before existing claude-mem context blocks. Most time-sensitive info reads top-down.

**Idempotency:** `consumed_at IS NULL` filter + atomic UPDATE ensures single injection even if SessionStart fires twice.

## Error Handling & Edge Cases

| Scenario | Behavior |
|----------|----------|
| Worker down at PreCompact | Hook exits 0, no briefing. Compaction proceeds. Resume uses existing context handler. |
| LLM call fails/timeout | Fall back to template-only briefing. Still stored, still injected. |
| Transcript file unreadable | Template-only briefing, log warn. |
| PreCompact fires but SessionStart never does | Briefing stays unconsumed. Cron cleanup: delete unconsumed briefings older than 7 days. |
| Multiple compactions in one session | Each PreCompact inserts new row. Latest unconsumed wins at injection. Older unconsumed marked consumed as "superseded" for audit. |
| Session excluded from tracking | PreCompact handler exits early, same as other handlers. |
| Briefing exceeds 500 tokens | Hard truncate template sections first. Never truncate LLM summary. |
| Race: briefing generating when SessionStart fires | Accept: this resume misses briefing. Future compact regenerates. Not worth sync-waiting. |
| Flag disabled mid-session | PreCompact skips. SessionStart finds nothing. Normal resume. |
| Concurrent agents same session_id | Not possible — session_id is per-Claude-Code-instance. |

## Testing

### Unit tests (Vitest, existing pattern)

- `BriefingGenerator.test.ts` — stub LLM, verify template sections, token budget, truncation order, LLM fallback
- `pre-compact.test.ts` — flag off skips, worker down exits 0, happy path POSTs `/api/briefings/generate`
- `context.test.ts` (extend existing) — briefing injection order, `consumed_at` update, no briefing = unchanged, flag off = unchanged
- `briefings-repo.test.ts` — SQLite CRUD, pending lookup returns latest unconsumed, idempotent consume

### Integration tests

- `briefings-e2e.test.ts` — full flow against real worker: PreCompact POST → SQLite row → SessionStart GET → consumed. Real SQLite, stubbed LLM.

### Manual validation (feature-flagged rollout)

1. Enable flag on dev machine
2. Start session, trigger auto-compact via 30+ tool calls
3. Inspect `session_briefings` table: row created with sensible content
4. Verify next message after compact receives briefing
5. Smoke test: disable flag mid-session → no breakage

### Migration test

Migration 28 idempotent. Safe on fresh DB and on DB already at v27.

## Out of Scope

- Cross-session briefings (yesterday's work)
- Manual "briefing now" command
- Viewer UI for briefing history (future enhancement, data already stored for it)
- Sync of briefings to team corpus (briefings are per-agent, per-session — not shared knowledge)

## Rollout

1. Build behind flag (`CLAUDE_MEM_AMNESIA_RECOVERY_ENABLED=false` default)
2. Dogfood internally 1 week
3. Document in `docs/public/features/`
4. Enable by default after telemetry confirms: briefing generation success rate >95%, injection latency <500ms p95, no compaction-blocking incidents
