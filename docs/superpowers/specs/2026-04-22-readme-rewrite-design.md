# README Rewrite — Design Spec

**Date:** 2026-04-22
**Scope:** Full rewrite of `README.md`
**Audience:** Internal team members onboarding to Engram
**Goal:** Deep onboarding — get running fast, then build a complete mental model

---

## Context

The current README is the upstream `claude-mem` README with a small Engram-specific install block bolted on top. It contains irrelevant content (i18n translations, star history chart, Trendshift badge, OpenClaw, Endless Mode, $CMEM crypto section, upstream copyright) and barely covers Engram's actual differentiators: multi-agent sync, Supabase backend, Vercel API, learning extraction, tick log, admin dashboard.

The repo is **private** and used by a **small internal team**. No public marketing. No upstream references.

---

## Structure: Progressive Disclosure

Ordered by time-to-value. New member gets the system running in ~10 minutes, then goes deeper into architecture and dev workflow as needed.

---

## Section 1 — Header & What Is This

Plain `# Engram` heading. No logo, no badges, no i18n flags.

One tight paragraph explaining what Engram is, what problem it solves, and who it's for:

> Engram is the team's shared AI memory system. It runs as a background worker on each developer's machine, capturing everything Claude Code does across sessions, syncing it to a shared Supabase backend, and injecting relevant context back at the start of each new session. The result: Claude knows what you were doing last week, what your teammates discovered yesterday, and what's already been tried.

Followed by a **"What you get"** bullet list:
- Persistent memory across sessions
- Cross-agent sync via Supabase
- Learning extraction (LLM-distilled insights from sessions)
- Admin review dashboard (approve/reject/edit pending learnings)
- Local tick log and worker UI at `localhost:37777`
- Semantic + full-text memory search

---

## Section 2 — Install

**Prerequisites**
- Bun
- Node.js ≥ 18
- Agent key (from Thiago)

**Install**
```bash
claude plugin install https://github.com/tsantana84/engram
```
Requires GitHub access to the private `tsantana84/engram` repo. Setup wizard runs automatically. Prompts for agent key and machine name (e.g. `thiago-macbook`).

**Verify**
```bash
curl http://localhost:37777/api/health
```
Worker running = syncing.

**Day-to-day commands** (subsection)
```bash
npm run build-and-sync        # rebuild + sync to plugin dir + restart worker
npm run worker:force-restart  # restart without rebuild
```

---

## Section 3 — Using Engram

### Memory Search

Invoke `mem-search` skill or use MCP tools directly. Three-layer workflow for token efficiency:

1. `search` — compact index, ~50–100 tokens/result
2. `timeline` — chronological context around results
3. `get_observations([ids])` — full details for filtered IDs only

Example:
```
search("auth bug fix") → get IDs → get_observations([123, 456])
```

### Review Dashboard

`https://<vercel-url>/dashboard` — approve, reject, or edit pending learnings. Auth: Bearer token using your agent key. ConflictDetector runs on Approve to catch duplicates.

### Local Worker UI

`http://localhost:37777` — three pages:
- **Sessions** — paginated observations, summaries, prompts with SSE live updates
- **Ticks** — SyncWorker tick log (IDLE/OK/PARTIAL/FAIL), last 1000 ticks, auto-refresh 60s
- **Admin** — agent management, queue status, sync health

### Privacy

Wrap sensitive content in `<private>...</private>` tags. Stripped at the hook layer before anything reaches the worker or database.

---

## Section 4 — How It Works

### Local Pipeline

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

### Sync & Backend

Vercel serverless functions receive sync payloads from each agent and write to Supabase. Key endpoints: `api/sync/push`, `api/sync/learnings` (learning-specific payloads), `api/sync/status`, `api/search`, `api/timeline`, `api/agents/`.

ConflictDetector runs server-side when a learning is approved via the dashboard. High-confidence learnings (≥ threshold) auto-approve; low-confidence learnings queue for manual review.

### Key Components

| Component | Path | Role |
|---|---|---|
| Hooks | `src/hooks/*.ts` | Lifecycle capture; built to `plugin/scripts/` |
| SyncWorker | `src/services/sync/SyncWorker.ts` | Tick loop, drains queue, orchestrates sync |
| SyncQueue | `src/services/sync/SyncQueue.ts` | SQLite-backed write queue |
| LearningExtractor | `src/services/sync/LearningExtractor.ts` | Session-end LLM distillation |
| ConflictDetector | `src/services/sync/ConflictDetector.ts` | Server-side dedup on approval |
| SupabaseManager | `api/lib/SupabaseManager.ts` | All Supabase interactions |
| ViewerRoutes | `src/services/worker/http/routes/ViewerRoutes.ts` | Serves local HTML pages |

**Full architecture reference:** `CLAUDE.md`

---

## Section 5 — Dev Guide

### Build & Run

```bash
npm run build-and-sync        # build + sync to plugin dir + restart worker
npm run worker:force-restart  # restart without rebuild
```

### Test

```bash
bun test   # runs full test suite — all must pass before pushing
```

### Key Environment Variables

Set in `~/.engram/settings.json` (JSON format):

```json
{
  "CLAUDE_MEM_LEARNING_EXTRACTION_ENABLED": "true",
  "CLAUDE_MEM_LEARNING_CONFIDENCE_THRESHOLD": "0.9",
  "CLAUDE_MEM_SYNC_INTERVAL_MS": "30000"
}
```

| Variable | Default | Description |
|---|---|---|
| `CLAUDE_MEM_LEARNING_EXTRACTION_ENABLED` | `false` | Enable session-end LLM distillation |
| `CLAUDE_MEM_LEARNING_CONFIDENCE_THRESHOLD` | `0.9` | Auto-approve threshold for learnings |
| `CLAUDE_MEM_SYNC_INTERVAL_MS` | `30000` | Sync tick interval in milliseconds |

### Adding a Vercel API Endpoint

Add a file under `api/`. Use `SupabaseManager` for all DB access. Deploy with `vercel --prod`. Before writing a new endpoint, browse `api/learnings/` — it's the dominant pattern in the codebase (list, review, counts, detail, id-based routes). See `CLAUDE.md` for full conventions.

### Contributing

- Branch off `main`
- Keep all tests green
- Run `npm run build-and-sync` before pushing
- No need to update CHANGELOG — auto-generated

---

## What Gets Cut

Everything from the upstream README not relevant to Engram:
- Logo images and i18n flag links
- Star history chart and Trendshift badge
- `npx claude-mem install` instructions
- OpenClaw integration
- Endless Mode / beta channel
- `$CMEM` crypto section
- Copyright "Alex Newman (@thedotmack)"
- Windows setup notes (internal team = Mac)
- External Discord/X/support links

---

## Success Criteria

A new team member can:
1. Install Engram and verify it's running in under 15 minutes
2. Find a past solution using mem-search within their first session
3. Understand the full sync pipeline without reading source code
4. Add a Vercel API endpoint with no additional guidance
