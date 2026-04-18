# Engram Architecture HTML — Design Spec

**Date:** 2026-04-18  
**Audience:** Personal reference  
**Output:** Single self-contained HTML file at `docs/architecture.html`

## Goal

A standalone HTML file that serves as a rich, interactive architecture reference for the engram codebase. No framework, no build step — open in any browser.

## Diagram Style

Interactive map: clickable subsystem panels that expand inline to show components + one-liners. One dedicated Mermaid.js data-flow diagram at the top.

## Detail Level

Component level: name + one-line purpose per component. No file paths.

## Page Structure

### 1. Header (sticky)
- Title: "engram architecture"
- Subtitle: "interactive reference · fork of claude-mem v12.1.0"

### 2. Data Flow Diagram (Mermaid.js)

Full end-to-end pipeline rendered as a flowchart. Two parallel write paths from the Worker:

```
Claude Code
  → Hook (5 types, tag-stripped at edge)
  → Worker :37777 (Express, Bun)
  ├─→ ChromaSync (vector embeddings, parallel write)
  └─→ SQLite (local DB)
       → SyncQueue
       → SyncWorker
         → SessionEnd: LearningExtractor
           ├─→ [confidence ≥ threshold] → SyncClient → Vercel API → Supabase
           └─→ [confidence < threshold] → pending learnings
                 → Dashboard review (approve/reject/edit)
                   → ConflictDetector → Supabase
```

**Mermaid initialization:** Must call `mermaid.initialize({startOnLoad: true})` in a `<script>` block after the CDN `<script>` tag. Without this, diagram renders as raw text.

CDN: `https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js`

Rendered inside a section open by default.

### 3. Subsystem Grid (3-column)

Nine panels, each with a color accent, title, and collapsed state by default.  
Click to expand → shows component cards (name + one-liner).  
Multiple panels can be open simultaneously. Click again to collapse.  
No keyboard accessibility required (personal reference).

| Panel | Accent | Components |
|---|---|---|
| **Hooks** | blue | SessionStart — injects past context into prompt; UserPromptSubmit — tag-strips privacy, routes to worker; PostToolUse — captures tool results; Summary — stores session summary; SessionEnd — triggers learning extraction |
| **Worker Service** | green | worker-service.ts — Express entrypoint, Bun-managed; SessionManager — tracks active sessions; SearchManager — orchestrates search + team results; SSEBroadcaster — real-time UI events; GeminiAgent / SDKAgent / OpenRouterAgent — LLM providers for AI processing; ResponseProcessor — normalizes agent output; SessionCompletionHandler — finalizes sessions |
| **SQLite / Local DB** | purple | Database — SQLite3 connection manager; SessionStore — session CRUD + SyncQueue injection; Observations — stores per-turn observations; Summaries — stores session summaries; Prompts — stores user prompts; Sessions — session metadata; SyncQueue — outbound sync items (storage layer, owned here); MigrationRunner — versioned schema migrations |
| **Sync Pipeline** | orange | SyncQueue — behavior layer, drains outbound items; SyncClient — HTTP push to Vercel backend; SyncWorker — tick-based worker, orchestrates drain + extraction; LearningExtractor — session-end LLM distillation → {claim, evidence, scope, confidence}; ConflictDetector — LLM dedup on approval path |
| **Chroma / Vector Search** | emerald | ChromaSync — writes observation embeddings to local Chroma store; ChromaMcpManager — MCP interface to Chroma; HybridSearchStrategy — merges SQLite + Chroma results; ChromaSearchStrategy — semantic vector search |
| **Vercel API** | teal | push.ts — receives sync payloads; status.ts — queue status; invalidate.ts — invalidate a learning; search.ts — unified search (observations + approved learnings); timeline.ts — timeline queries; agents/create, revoke, list — agent key management; learnings/review — approve/reject/edit; health.ts, db-check.ts — ops |
| **Supabase** | indigo | observations — synced observation rows; sessions — synced session metadata; summaries — synced summaries; learnings — extracted learnings with status (pending / approved / rejected); agent_keys — bearer token auth for agents |
| **Review Dashboard** | pink | public/dashboard/ — DOM-safe HTML/JS UI; bearer token auth (agent key); Approve / Reject / Edit actions; ConflictDetector runs server-side on Approve; buttons disabled during in-flight requests |
| **Viewer UI** | slate | React SPA at :37777; Feed — paginated observation + summary stream; ObservationCard / SummaryCard — typed entry renderers; SSE stream — live updates; SearchRoutes — search UI; ContextSettingsModal — configure context injection |

### 4. Integrations Strip (bottom)

Horizontal row of badges:  
`Cursor · Gemini CLI · Windsurf · OpenCode · OpenClaw · Codex CLI`

## Technical Approach

- **Single HTML file** — no build step, no external assets except Mermaid CDN
- **Pure CSS + JS** — panel expand/collapse via CSS class toggle on click
- **Multiple panels open** — independent toggle state per panel
- **Dark theme** — #0f1117 background, consistent with engram aesthetic
- **Mermaid.js** — cdnjs v10.9.1, `startOnLoad: true` initialization required
- **System fonts** — no webfont CDN dependency

## Output Location

`docs/architecture.html`

## Success Criteria

- Opens in browser offline (except Mermaid CDN for flow diagram)
- All 9 subsystem panels expand/collapse independently
- Data flow diagram renders including Chroma parallel write path
- Correct component names and one-liners matching actual codebase
- Integrations strip shows all 6 integrations including OpenClaw
