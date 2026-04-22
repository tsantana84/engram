# Engram

## What Is This

Engram is the team's shared AI memory system. It runs as a background worker on each developer's machine, capturing everything Claude Code does across sessions, syncing it to a shared Supabase backend, and injecting relevant context back at the start of each new session. The result: Claude knows what you were doing last week, what your teammates discovered yesterday, and what's already been tried.

**What you get:**

- Persistent memory across sessions
- Cross-agent sync via Supabase
- Learning extraction (LLM-distilled insights from sessions)
- Admin review dashboard (approve/reject/edit pending learnings)
- Local tick log and worker UI at `http://localhost:37777`
- Semantic + full-text memory search

## Install

### Prerequisites

- [Bun](https://bun.sh) (auto-installed if missing)
- Node.js ≥ 18
- Agent key — request from Thiago

### Install the plugin

```bash
claude plugin install https://github.com/tsantana84/engram
```

> Requires GitHub access to the private `tsantana84/engram` repo.

The setup wizard runs automatically on install. When prompted:
- Enter your agent key
- Enter a machine name (e.g. `thiago-macbook` — identifies this device in shared memory)

### Verify it's running

```bash
curl http://localhost:37777/api/health
```

A JSON response means the worker is up and syncing.

### Day-to-day

```bash
npm run build-and-sync        # rebuild + sync plugin to install dir + restart worker
npm run worker:force-restart  # restart without rebuild (use after manual settings change)
```

## Using Engram

### Memory search

Invoke the `mem-search` skill inside Claude Code, or use the MCP tools directly. Three-layer workflow to minimize token usage:

1. **`search`** — compact index, ~50–100 tokens/result
2. **`timeline`** — chronological context around results
3. **`get_observations([ids])`** — full details for filtered IDs only

```
search("auth bug fix") → review index → get_observations([123, 456])
```

### Review dashboard

`https://<vercel-url>/dashboard` — approve, reject, or edit pending learnings extracted from sessions. Auth: Bearer token (your agent key). The ConflictDetector runs on Approve to catch duplicates before they reach the shared store.

### Local worker UI

`http://localhost:37777` — three pages:

| Page | URL | What it shows |
|---|---|---|
| Sessions | `/` | Paginated observations, summaries, prompts with SSE live updates |
| Ticks | `/ticks` | SyncWorker tick log (IDLE/OK/PARTIAL/FAIL), last 1000 ticks, auto-refresh 60s |
| Admin | `/admin` | Agent management, queue status, sync health |

### Privacy

Wrap sensitive content in `<private>...</private>` tags. These are stripped at the hook layer before anything reaches the worker or database.

## How It Works

### Local pipeline

```
Claude Code session
  → 5 lifecycle hooks
     (SessionStart / UserPromptSubmit / PostToolUse / Summary / SessionEnd)
  → SQLite (~/.claude-mem/claude-mem.db)
     observations, summaries, sync_queue, tick_log
  → SyncWorker (port 37777, tick-based)
  → LearningExtractor (session-end LLM distillation)
  → SyncQueue → Vercel API
```

### Sync & backend

Vercel serverless functions receive sync payloads from each agent and write to Supabase.

Key endpoints:

| Endpoint | Purpose |
|---|---|
| `api/sync/push` | Receive observation/summary payloads |
| `api/sync/learnings` | Receive learning-specific payloads |
| `api/sync/status` | Queue status |
| `api/search` | Unified search (observations + approved learnings) |
| `api/timeline` | Chronological queries |
| `api/agents/` | Agent key management |

ConflictDetector runs server-side when a learning is approved via the dashboard. High-confidence learnings (≥ threshold) auto-approve; low-confidence learnings queue for manual review.

### Key components

| Component | Path | Role |
|---|---|---|
| Hooks | `src/hooks/*.ts` | Lifecycle capture; built to `plugin/scripts/` |
| SyncWorker | `src/services/sync/SyncWorker.ts` | Tick loop, drains queue, orchestrates sync |
| SyncQueue | `src/services/sync/SyncQueue.ts` | SQLite-backed write queue |
| LearningExtractor | `src/services/sync/LearningExtractor.ts` | Session-end LLM distillation |
| ConflictDetector | `src/services/sync/ConflictDetector.ts` | Server-side dedup on approval |
| SupabaseManager | `api/lib/SupabaseManager.ts` | All Supabase interactions |
| ViewerRoutes | `src/services/worker/http/routes/ViewerRoutes.ts` | Serves local HTML pages |

For full architecture detail, see `CLAUDE.md`.

## Dev Guide
