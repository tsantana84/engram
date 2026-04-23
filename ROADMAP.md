# Engram Roadmap

## Feature Pipeline

### P1 — Structured Correction Journal
When the user explicitly corrects the agent mid-session, capture a typed correction record: `{tried, wrong_because, fix, trigger_context}`. Corrections receive a 2× retrieval weight bonus and are auto-injected into session prewarm when the session goal matches `trigger_context`. Detection: keyword heuristic gate at UserPromptSubmit, LLM extraction only when gate fires.

### P1 — Goal-Aware Session Prewarm ✅
Compact ~500-token directive briefing from 3 sources (last session next_steps/completed, corrections, past decisions) injected at SessionStart (static template, <50ms) and UserPromptSubmit (LLM-composed, goal-aware). Format: imperative directives ("Watch out:", "Decisions made:") not history log. Supersedes old corrections-only prewarm.

### P1 — Proactive Pre-Task Briefing
Scan file/task context at `UserPromptSubmit` → surface 3 most relevant past learnings automatically. No search command needed; injected before every prompt.

### P1 — Memory-Aware Code Review
When reviewing a PR, auto-inject past decisions, past bugs, and learnings scoped to the same files. "We tried this pattern in March and it caused X" surfaces without asking.

### P1 — Decision Log
Auto-detect architectural decisions ("we decided to...", "going with X because...") during observations. Tag and store separately. Queryable: `search decisions about auth`.

---

### P2 — Stale Memory Decay
Score observations by recency + reinforcement (re-referenced = stays fresh). Auto-archive stale entries. Dashboard: corpus health score (coverage, freshness, conflict rate).

### P2 — Conflict Resolution UI
Make `ConflictDetector` results visible. When two agents write conflicting learnings, surface as diff in dashboard. Reviewer picks canonical truth.

---

### P3 — Private Memory Tiers
Three sync scopes: `personal` (never syncs), `project` (team sync), `org` (global sync). Extends existing `<private>` tag. Different retention and visibility per tier.

### P3 — Session Narrative
LLM-generated 3-sentence summary per session: what happened, what was decided, what's left. Stored as summary artifact. Makes timeline human-readable at a glance.

### P3 — Memory Export / Briefing Doc
One command: export full memory corpus for a project as structured markdown. Use for onboarding new agents, project archiving, or human handoff.
