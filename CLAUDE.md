# Engram: AI Development Instructions

Engram is a fork of [claude-mem](https://github.com/thedotmack/claude-mem) (v12.1.0) with multi-agent sync added on top. It provides persistent memory across Claude Code sessions, plus a Supabase-backed sync layer so multiple agents share context.

## Architecture

**5 Lifecycle Hooks**: SessionStart → UserPromptSubmit → PostToolUse → Summary → SessionEnd

**Hooks** (`src/hooks/*.ts`) - TypeScript → ESM, built to `plugin/scripts/*-hook.js`

**Worker Service** (`src/services/worker-service.ts`) - Express API on port 37777, Bun-managed, handles AI processing asynchronously

**Database** (`src/services/sqlite/`) - SQLite3 at `~/.claude-mem/claude-mem.db`

**Search Skill** (`plugin/skills/mem-search/SKILL.md`) - HTTP API for searching past work, auto-invoked when users ask about history

**Planning Skill** (`plugin/skills/make-plan/SKILL.md`) - Orchestrator instructions for creating phased implementation plans with documentation discovery

**Execution Skill** (`plugin/skills/do/SKILL.md`) - Orchestrator instructions for executing phased plans using subagents

**Chroma** (`src/services/sync/ChromaSync.ts`) - Vector embeddings for semantic search

**Viewer UI** (`src/ui/viewer/`) - React interface at http://localhost:37777, built to `plugin/ui/viewer.html`

## Sync Pipeline (Engram-specific)

**SyncQueue** (`src/services/sync/SyncQueue.ts`) - SQLite-backed queue; `storeObservation`/`storeSummary` enqueue items after writes

**SyncClient** (`src/services/sync/SyncClient.ts`) - HTTP client pushing queue items to Vercel backend

**SyncWorker** (`src/services/sync/SyncWorker.ts`) - Tick-based worker; drains queue, runs learning extraction when enabled

**ConflictDetector** (`src/services/sync/ConflictDetector.ts`) - LLM-based dedup/conflict detection for learnings; runs server-side on approval path

**LearningExtractor** (`src/services/sync/LearningExtractor.ts`) - Session-end LLM distillation; extracts `{claim, evidence, scope, confidence}` from observations. High-confidence (≥threshold) learnings auto-sync; low-confidence queue as `pending` for dashboard review

**Vercel API** (`api/`) - Serverless functions:
- `api/sync/push.ts` — receives sync payloads from agents
- `api/sync/status.ts` — queue status
- `api/sync/invalidate.ts` — invalidate a learning
- `api/search.ts` — unified search (observations + approved learnings)
- `api/timeline.ts` — timeline queries
- `api/agents/` — agent key management (create, revoke, list)
- `api/health.ts`, `api/db-check.ts` — ops endpoints
- `api/lib/SupabaseManager.ts` — all Supabase interactions

**Supabase migrations** (`supabase/`) - Schema versioned migrations

**Review Dashboard** (`public/dashboard/`) - DOM-safe UI for reviewing pending learnings. Bearer token auth (agent key). Actions: Approve / Reject / Edit. ConflictDetector runs on Approve.

## Learning Extraction Feature Flag

Disabled by default. Enable in worker env:

```bash
CLAUDE_MEM_LEARNING_EXTRACTION_ENABLED=true
CLAUDE_MEM_CONFIDENCE_THRESHOLD=0.8   # default
```

## Privacy Tags
- `<private>content</private>` - User-level privacy control (manual, prevents storage)

**Implementation**: Tag stripping happens at hook layer (edge processing) before data reaches worker/database. See `src/utils/tag-stripping.ts` for shared utilities.

## Build Commands

```bash
npm run build-and-sync        # Build, sync to marketplace, restart worker
```

## Configuration

Settings are managed in `~/.claude-mem/settings.json`. The file is auto-created with defaults on first run.

## File Locations

- **Source**: `<project-root>/src/`
- **Built Plugin**: `<project-root>/plugin/`
- **Installed Plugin**: `~/.claude/plugins/marketplaces/thedotmack/` (plugin ID: `engram@thedotmack`)
- **Database**: `~/.claude-mem/claude-mem.db`
- **Chroma**: `~/.claude-mem/chroma/`

## Exit Code Strategy

Hooks use specific exit codes per Claude Code's hook contract:

- **Exit 0**: Success or graceful shutdown (Windows Terminal closes tabs)
- **Exit 1**: Non-blocking error (stderr shown to user, continues)
- **Exit 2**: Blocking error (stderr fed to Claude for processing)

**Philosophy**: Worker/hook errors exit with code 0 to prevent Windows Terminal tab accumulation. The wrapper/plugin layer handles restart logic. ERROR-level logging is maintained for diagnostics.

See `private/context/claude-code/exit-codes.md` for full hook behavior matrix.

## Requirements

- **Bun** (all platforms - auto-installed if missing)
- **uv** (all platforms - auto-installed if missing, provides Python for Chroma)
- Node.js

## Documentation

**Public Docs**: https://docs.claude-mem.ai (Mintlify)
**Source**: `docs/public/` - MDX files, edit `docs.json` for navigation
**Deploy**: Auto-deploys from GitHub on push to main

## Pro Features Architecture

Engram is designed with a clean separation between open-source core functionality and optional Pro features.

**Open-Source Core** (this repository):

- All worker API endpoints on localhost:37777 remain fully open and accessible
- Pro features are headless - no proprietary UI elements in this codebase
- Pro integration points are minimal: settings for license keys, tunnel provisioning logic
- The architecture ensures Pro features extend rather than replace core functionality

**Pro Features** (coming soon, external):

- Enhanced UI (Memory Stream) connects to the same localhost:37777 endpoints as the open viewer
- Additional features like advanced filtering, timeline scrubbing, and search tools
- Access gated by license validation, not by modifying core endpoints
- Users without Pro licenses continue using the full open-source viewer UI without limitation

## Important

No need to edit the changelog ever, it's generated automatically.
