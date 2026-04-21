# Engram Roadmap

## Feature Pipeline

### ⭐ P0 — Amnesia Recovery Protocol
**The big one.** Detect Claude Code context compression → auto-inject targeted session briefing (current task, recent decisions, open questions, active files) so Claude wakes up with full context. Engram already sits at the hook layer; this turns it from passive recorder into active continuity engine.

- Hook: detect compression event in `UserPromptSubmit` (context token delta spike)
- Build: `AmnesiaBriefing` — distilled snapshot from last N observations + open todos
- Inject: briefing prepended to next prompt transparently
- No user action required

---

### P1 — Proactive Pre-Task Briefing
Scan file/task context at `UserPromptSubmit` → surface 3 most relevant past learnings automatically. No search command needed; injected before every prompt.

### P1 — Memory-Aware Code Review
When reviewing a PR, auto-inject past decisions, past bugs, and learnings scoped to the same files. "We tried this pattern in March and it caused X" surfaces without asking.

### P1 — Decision Log
Auto-detect architectural decisions ("we decided to...", "going with X because...") during observations. Tag and store separately. Queryable: `search decisions about auth`.

---

### P2 — Memory Graph
Build a relationship graph linking observations to files, functions, decisions, other observations. Graph traversal complements Chroma semantic search. "Show everything connected to `SupabaseManager`."

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
