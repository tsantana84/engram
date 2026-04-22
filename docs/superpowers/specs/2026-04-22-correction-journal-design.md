# Structured Correction Journal — Design Spec

**Date**: 2026-04-22
**Priority**: P1
**Status**: Approved

## Overview

When an agent makes a mistake and a user explicitly corrects it, engram captures the correction as a typed, structured record. Corrections are stored with a retrieval-weight bonus so they surface with priority in search and are automatically injected into session prewarm when the session goal matches the correction's trigger context.

Mistakes are more compressible than successes — a correction record is denser and more actionable than a general observation.

## Schema (Migration 35)

New migration method added to both `MigrationRunner.runAllMigrations()` and `SessionStore` constructor chain. NOT a Supabase migration — this is a local SQLite table.

```sql
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
);
CREATE INDEX IF NOT EXISTS idx_corrections_trigger ON corrections(trigger_context);
CREATE INDEX IF NOT EXISTS idx_corrections_project ON corrections(project);
```

### Field Definitions

| Field | Description |
|---|---|
| `tried` | What the agent attempted |
| `wrong_because` | Why it was wrong |
| `fix` | The correct approach |
| `trigger_context` | Short phrase describing when this mistake recurs (e.g. "migrating database columns") |
| `weight_multiplier` | Retrieval score multiplier (default 2.0) |
| `project` | Project path for prewarm scoping |

### Type System

Add `'correction'` to the `ObservationRow.type` union in `src/services/sqlite/types.ts` and `src/types/database.ts`. Add `'correction'` to `observation_types` in **all** mode JSON files under `plugin/modes/` (every `.json` file in that directory — not just `code.json`) so the SDK parser accepts it regardless of which mode the user runs.

### Dual-Write Strategy (Atomic)

Corrections are written to two SQLite places inside a single `db.transaction()`:
1. `corrections` table — structured schema for prewarm queries and direct inspection
2. `observations` table with `type='correction'` — so existing Chroma semantic search includes them

Both writes succeed or both fail. The Chroma upsert runs outside the transaction (best-effort, same pattern as existing observation writes).

## Detection + Extraction (UserPromptSubmit Hook)

### Heuristic Gate

Fire only when the user message contains a correction-signaling word. Requires at least one strong signal:

```
/\b(wrong|incorrect|stop doing|that's not right|don't do that|that was wrong|you shouldn't)\b/i
```

Narrower than a broad "no/instead/actually" pattern — avoids firing on redirects and style preferences. Zero LLM cost when gate does not fire.

### Extraction (LLM call, only when gate fires)

Context window assembled: last tool output + last assistant message + current user message.

LLM configuration: `CorrectionExtractor` defines its own `CorrectionExtractorConfig` interface with explicit fields: `{ enabled: boolean; llm: (prompt: string) => Promise<string>; model: string; maxTokens: number }`. Default: `maxTokens: 300`, `temperature: 0`. The `model` and `maxTokens` values are passed into the `llm` callback by the caller — same delegation pattern as `LearningExtractor`, but with the fields declared explicitly in the config struct rather than baked into the callback.

LLM prompt:
```
Extract a correction from this exchange. Return null if no clear mistake was made.
{context}

Return JSON or null: {"tried": "...", "wrong_because": "...", "fix": "...", "trigger_context": "..."}
trigger_context: short phrase (3-6 words) describing WHEN this mistake recurs (e.g. "migrating database columns", "writing commit messages").
Skip empty trigger_context — return null instead.
```

### Async Write

Non-blocking — extracted record posted to worker via HTTP POST. Hook returns immediately. Worker handles the atomic dual-write. Corrections are **best-effort** (no SyncQueue durability) — this matches the existing pattern for session-init hook calls. A worker crash between gate fire and POST response silently drops the correction; this is acceptable for P1 scope.

## Prewarm (SessionStart)

Session goal proxy: use the title of the most recent observation from the current project (last session's last recorded action). If unavailable, skip correction injection.

Prewarm query — project-scoped:

```sql
SELECT tried, wrong_because, fix, trigger_context
FROM corrections
WHERE project = ?
  AND trigger_context != ''
ORDER BY weight_multiplier DESC, created_at DESC
LIMIT 10
```

Scored against session goal via keyword overlap on `trigger_context`. Top 3 injected before observations in prewarm block:

```
PAST CORRECTIONS (high priority):
- Tried: {tried}. Wrong because: {wrong_because}. Fix: {fix}.
  [Context: {trigger_context}]
```

No LLM call at prewarm — fast keyword scoring only. If corrections table empty or goal unavailable, injection is skipped silently.

## Retrieval Weight Bonus

In `SearchManager` (not a new file), after `queryChroma()` returns candidates: join results where `observations.type = 'correction'` against `corrections` for `weight_multiplier`. Multiply score before final ranking. Corrections surface above equal-relevance observations without UI changes.

## Implementation Components

| Component | File | What |
|---|---|---|
| Migration 35 | `src/services/sqlite/migrations/runner.ts` + `SessionStore` | `createCorrectionsTable()` in both migration paths |
| Type registration | `src/services/sqlite/types.ts` + `src/types/database.ts` | Add `'correction'` to type union and mode config |
| Hook detection | `src/hooks/user-prompt-submit.ts` | Heuristic gate |
| Extraction + write | `src/services/sync/CorrectionExtractor.ts` | LLM extraction, atomic dual-write via `db.transaction()` |
| Worker route | `src/services/worker/http/routes/` | POST endpoint receiving extracted correction |
| Prewarm | `src/hooks/session-start.ts` | SQL fetch (project-scoped) + inject top 3 |
| Search scoring | `src/services/worker/SearchManager.ts` | Weight multiplier applied post-`queryChroma()` |

## Roadmap Placement

P1 — ships alongside or after Decision Log. Both are hook-layer features (UserPromptSubmit detection + structured storage). Natural pairing.
