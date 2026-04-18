# Engram Architecture HTML — Design Spec

**Date:** 2026-04-18  
**Audience:** Personal reference  
**Output:** Single self-contained HTML file

## Goal

A standalone HTML file that serves as a rich, interactive architecture reference for the engram codebase. No framework, no build step — open in any browser.

## Diagram Style

Interactive map (C): clickable subsystem panels that expand inline to show components + one-liners. One dedicated Mermaid.js data-flow diagram at the top.

## Detail Level

Component level: name + one-line purpose per component. No file paths.

## Page Structure

### 1. Header (sticky)
- Title: "engram architecture"
- Subtitle: "interactive reference · fork of claude-mem v12.1.0"

### 2. Data Flow Diagram (Mermaid.js)
Full end-to-end pipeline rendered as a flowchart:

```
Claude Code
  → Hook (5 types, tag-stripped)
  → Worker :37777 (Express, Bun)
  → SQLite (local DB)
  → SyncQueue
  → SyncWorker
    → [confidence ≥ threshold] → SyncClient → Vercel API → Supabase
    → [confidence < threshold] → pending learnings
      → Dashboard review (approve/reject/edit)
        → ConflictDetector → Supabase
```

Also shows: SessionEnd → LearningExtractor → SyncWorker path.

Mermaid loaded via CDN (cdnjs). Rendered inside a collapsible section, open by default.

### 3. Subsystem Grid (3-column)

Eight panels, each with a color accent, title, and collapsed state by default.  
Click to expand → shows component cards (name + one-liner).  
Click again to collapse.

| Panel | Accent color | Components |
|---|---|---|
| **Hooks** | blue | SessionStart, UserPromptSubmit, PostToolUse, Summary, SessionEnd |
| **Worker Service** | green | worker-service.ts, SessionManager, SearchManager, SSEBroadcaster, SyncWorker, LearningExtractor |
| **SQLite / Local DB** | purple | Database, SessionStore, Observations, Summaries, Prompts, Sessions, SyncQueue, MigrationRunner |
| **Sync Pipeline** | orange | SyncQueue, SyncClient, SyncWorker, LearningExtractor, ConflictDetector |
| **Vercel API** | teal | push, status, invalidate, search, timeline, agents (create/revoke/list), learnings review, health |
| **Supabase** | indigo | observations table, sessions table, summaries table, learnings table (status: pending/approved/rejected), agent_keys table |
| **Review Dashboard** | pink | public/dashboard/ — DOM-safe UI, bearer token auth, approve/reject/edit actions |
| **Viewer UI** | slate | React :37777 — Feed, ObservationCard, SummaryCard, SearchRoutes, SSE stream |

### 4. Integrations Strip (bottom)
Horizontal row of badges: Cursor · Gemini CLI · Windsurf · OpenCode · Codex CLI

## Technical Approach

- **Single HTML file** — no build step, no external assets except Mermaid CDN
- **Pure CSS + JS** — panel expand/collapse via CSS class toggle
- **Dark theme** — consistent with engram's aesthetic, #0f1117 background
- **Mermaid.js** — loaded from cdnjs for the data-flow diagram only
- **Self-contained** — font stack uses system fonts, no webfont CDN

## Output Location

`docs/architecture.html` in the engram repo root (accessible, not buried in docs/).

## Success Criteria

- Open in browser, no network required except Mermaid CDN for the flow diagram
- All 8 subsystem panels expand/collapse correctly
- Data flow diagram renders end-to-end pipeline
- Correct component names and one-liners for each subsystem
