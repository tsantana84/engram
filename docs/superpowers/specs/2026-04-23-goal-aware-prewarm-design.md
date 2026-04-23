# Goal-Aware Session Prewarm — Design Spec

**Date**: 2026-04-23
**Priority**: P1
**Status**: Approved

## Problem

The current SessionStart context injection dumps a full observation timeline. The agent skims or ignores it because it is formatted as a history log (past-tense, date-grouped) rather than active instructions. The agent starts sessions without knowing: what was unfinished, what decisions were made, what mistakes to avoid, what the last session was doing.

## Solution

Replace the wall-of-history with a compact directive briefing block composed from 4 targeted sources. Two injection points with different strategies:

- **SessionStart**: static template, no LLM, fast (<50ms)
- **UserPromptSubmit**: LLM-composed, uses actual user prompt to filter and prioritize (≤2s, within existing 60s budget)

The existing observation timeline is preserved below the briefing for mem-search queries.

## Sources

| Source | Table/Field | Cap |
|---|---|---|
| Last session summary | `session_summaries` — most recent for project | 150 tokens |
| Open todos | `session_briefings.open_todos` — most recent | 100 tokens |
| Recent corrections | `corrections` WHERE project = ? ORDER BY created_at DESC LIMIT 3 | 100 tokens |
| Past decisions | `observations` WHERE type = 'decision' ORDER BY created_at DESC LIMIT 5 | 150 tokens |

Total budget: ~500 tokens.

## Output Format

```
## AGENT BRIEFING
**Last session:** [1-2 sentence summary of what was done and what's left]
**Unfinished:** [open todos as bullet list, or omitted if none]

**Watch out:**
- Tried: [tried]. Wrong because: [wrong_because]. Fix: [fix]. [Context: trigger_context]

**Decisions made:**
- [decision title/narrative, one line each]

---
```

Rules:
- Present tense, imperative voice — not past-tense log
- Grouped by type, not by date
- Entire block omitted if all sources are empty (fresh project)
- Each section omitted individually if its source returns no rows

## Components

### New: `src/services/context/BriefingComposer.ts`

Two exported functions:

**`buildSessionBriefing(db: SessionStore, project: string): string`**
- Queries all 4 sources from SQLite
- Formats as directive block using template (no LLM)
- Returns empty string if all sources empty
- Called at SessionStart

**`buildPromptBriefing(db: SessionStore, project: string, userPrompt: string, llm: (prompt: string) => Promise<string>): Promise<string>`**
- Queries same 4 sources
- Passes sources + user prompt to LLM: `"Given this task: {userPrompt}. Write a ≤500-token agent briefing from these sources. Prioritize what's relevant to the task. Use imperative voice. Omit irrelevant sections."`
- On LLM error: falls back to `buildSessionBriefing()` output (static template)
- Truncates hard at 500 tokens before returning
- Called at UserPromptSubmit

### Modified: `src/services/context/ContextBuilder.ts`

In `generateContext()`, after `db` is initialized and `project` is resolved:
```typescript
const briefing = buildSessionBriefing(db, project);
// ... existing observations/summaries query ...
return briefing + output; // prepend briefing to timeline
```

### Modified: `src/services/worker/http/routes/SessionRoutes.ts`

In `handleSessionInitByClaudeId`, after existing session-init logic:
```typescript
const briefing = await buildPromptBriefing(db, project, userPrompt, llm);
// Return briefing in hook response so it is injected before the prompt
```

Check how existing hook responses are structured in session-init to confirm the return format for context injection.

## Error Handling

| Scenario | Behavior |
|---|---|
| LLM fails at UserPromptSubmit | Fall back to static `buildSessionBriefing()` output |
| All 4 sources empty | Return empty string, inject nothing |
| LLM returns >500 tokens | Truncate hard at 500 tokens |
| `session_summaries` empty | Skip that section, compose from remaining 3 |
| No corrections for project | Omit corrections section |
| No decisions in observations | Omit decisions section |

## What Does NOT Change

- `BriefingGenerator.ts` — amnesia/context-recovery briefing, different purpose, untouched
- Observation timeline in `generateContext()` — preserved below the briefing block
- mem-search skill — unaffected, queries observations directly
- `corrections` prewarm block — superseded by the corrections section in the new briefing

## Relationship to Existing Prewarm

The `correctionsBlock` prepended in Task 6 of the Correction Journal feature is now superseded by the `Watch out` section in `buildSessionBriefing()`. Remove the standalone `correctionsBlock` from `ContextBuilder.ts` once `BriefingComposer` is wired in (avoid duplicate injection).
