# Engram README Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the upstream claude-mem README with an Engram-specific README for internal team onboarding.

**Architecture:** Progressive disclosure — five sections ordered by time-to-value. New team member gets running in ~10 minutes, then builds mental model of the full sync architecture and dev workflow. No marketing copy, no upstream references, no public-facing content.

**Tech Stack:** Markdown. No build step. Single file: `README.md`.

**Spec:** `docs/superpowers/specs/2026-04-22-readme-rewrite-design.md`

---

## Files

- Modify: `README.md` (full rewrite — all existing content replaced)

---

## Task 1: Wipe and Scaffold

Replace all current content with the five section headings and the plan header. This gives us the skeleton to fill in task by task.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace README with skeleton**

Write this exact content to `README.md`:

```markdown
# Engram

## What Is This

## Install

## Using Engram

## How It Works

## Dev Guide
```

- [ ] **Step 2: Verify skeleton is clean**

```bash
grep -c "claude-mem\|thedotmack\|OpenClaw\|CMEM\|Trendshift\|npx claude-mem\|i18n" README.md
```

Expected output: `0` — no upstream artifacts remain.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): wipe upstream content, scaffold engram structure"
```

---

## Task 2: Section 1 — Header & What Is This

- [ ] **Step 1: Write Section 1**

Replace the `## What Is This` heading and the empty line below it with:

```markdown
## What Is This

Engram is the team's shared AI memory system. It runs as a background worker on each developer's machine, capturing everything Claude Code does across sessions, syncing it to a shared Supabase backend, and injecting relevant context back at the start of each new session. The result: Claude knows what you were doing last week, what your teammates discovered yesterday, and what's already been tried.

**What you get:**

- Persistent memory across sessions
- Cross-agent sync via Supabase
- Learning extraction (LLM-distilled insights from sessions)
- Admin review dashboard (approve/reject/edit pending learnings)
- Local tick log and worker UI at `http://localhost:37777`
- Semantic + full-text memory search
```

- [ ] **Step 2: Verify**

```bash
grep -q "Supabase" README.md && echo "Supabase: OK"
grep -q "Learning extraction" README.md && echo "Learning extraction: OK"
grep -q "localhost:37777" README.md && echo "localhost:37777: OK"
```

Expected: all three lines print `OK`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): add What Is This section"
```

---

## Task 3: Section 2 — Install

- [ ] **Step 1: Write Section 2**

Replace the `## Install` heading with:

```markdown
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
```

- [ ] **Step 2: Verify**

```bash
grep -c "tsantana84\|agent key\|build-and-sync\|force-restart" README.md
```

Expected: `4`

- [ ] **Step 3: Verify no upstream install instructions**

```bash
grep -c "npx claude-mem\|plugin marketplace" README.md
```

Expected: `0`

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): add Install section"
```

---

## Task 4: Section 3 — Using Engram

- [ ] **Step 1: Write Section 3**

Replace the `## Using Engram` heading with:

```markdown
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
```

- [ ] **Step 2: Verify**

```bash
grep -c "mem-search\|get_observations\|ConflictDetector\|localhost:37777\|<private>" README.md
```

Expected: `5`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): add Using Engram section"
```

---

## Task 5: Section 4 — How It Works

- [ ] **Step 1: Write Section 4**

Replace the `## How It Works` heading with:

```markdown
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
```

- [ ] **Step 2: Verify component paths exist**

```bash
ls src/hooks/*.ts \
   src/services/sync/SyncWorker.ts \
   src/services/sync/SyncQueue.ts \
   src/services/sync/LearningExtractor.ts \
   src/services/sync/ConflictDetector.ts \
   api/lib/SupabaseManager.ts \
   src/services/worker/http/routes/ViewerRoutes.ts
```

Expected: all files listed with no errors.

- [ ] **Step 3: Verify API endpoints exist**

```bash
ls api/sync/push.ts api/sync/learnings.ts api/sync/status.ts api/search.ts api/timeline.ts api/agents/
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): add How It Works section"
```

---

## Task 6: Section 5 — Dev Guide

- [ ] **Step 1: Write Section 5**

Replace the `## Dev Guide` heading with:

```markdown
## Dev Guide

### Build & run

```bash
npm run build-and-sync        # build + sync to plugin dir + restart worker
npm run worker:force-restart  # restart without rebuild
```

### Test

```bash
bun test   # runs full test suite — all must pass before pushing
```

### Key environment variables

Set in `~/.engram/settings.json` (JSON format, all values are strings):

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
| `CLAUDE_MEM_SYNC_INTERVAL_MS` | `30000` | Sync tick interval (ms) |
| `CLAUDE_MEM_OPENAI_API_KEY` | — | Required when extraction is enabled (default provider: OpenAI) |
| `CLAUDE_MEM_LEARNING_LLM_PROVIDER` | `openai` | Switch to `anthropic` + set `CLAUDE_MEM_ANTHROPIC_API_KEY` to use Claude instead |

### Adding a Vercel API endpoint

Add a file under `api/`. Use `SupabaseManager` for all DB access. Deploy with `vercel --prod`.

Browse `api/learnings/` before writing a new endpoint — it's the dominant pattern (list, review, counts, detail, id-based routes). `api/sync/learnings.ts` is the sync-specific push path, not the CRUD pattern.

See `CLAUDE.md` for full conventions. Note: `CLAUDE.md` references `~/.claude-mem/` in some places — the correct path is `~/.engram/` (as shown above).

### Contributing

- Branch off `main`
- Keep all tests green (`bun test`)
- Run `npm run build-and-sync` before pushing
- No need to update CHANGELOG — it's auto-generated
```

- [ ] **Step 2: Verify variable names are correct**

```bash
grep "CLAUDE_MEM_LEARNING_CONFIDENCE_THRESHOLD\|CLAUDE_MEM_LEARNING_EXTRACTION_ENABLED\|CLAUDE_MEM_SYNC_INTERVAL_MS" README.md | wc -l
```

Expected: `6` (each variable appears twice — once in JSON snippet, once in table)

- [ ] **Step 3: Verify no wrong variable names**

```bash
grep "CLAUDE_MEM_CONFIDENCE_THRESHOLD" README.md
```

Expected: no output (the wrong name from the upstream README)

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): add Dev Guide section"
```

---

## Task 7: Final Verification Pass

- [ ] **Step 1: Check no upstream artifacts remain**

```bash
grep -iE "claude-mem|thedotmack|openclaw|CMEM|Trendshift|npx claude-mem|i18n|discord\.com|Endless Mode|star-history|Alex Newman|solana|ragtime" README.md
```

Expected: no output.

- [ ] **Step 2: Check all internal links/URLs are correct**

```bash
grep -E "localhost:|https://github.com|vercel-url|CLAUDE\.md" README.md
```

Review output manually — confirm:
- `localhost:37777` appears for worker UI
- `https://github.com/tsantana84/engram` for install
- `<vercel-url>` placeholder noted (intentional — team knows the URL)
- `CLAUDE.md` referenced for full architecture

- [ ] **Step 3: Confirm all 5 sections present**

```bash
grep -c "^## " README.md
```

Expected: `5` (What Is This, Install, Using Engram, How It Works, Dev Guide).

- [ ] **Step 4: Confirm file size is sane**

```bash
wc -l README.md
```

Expected: 80–150 lines. If under 80, something's missing. If over 200, something bloated.

- [ ] **Step 5: Final commit**

```bash
git add README.md
git commit -m "docs(readme): final verification pass complete"
```
