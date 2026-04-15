# Engram

> **Fork of [claude-mem](https://github.com/thedotmack/claude-mem) (v12.1.0)**
> Adds multi-agent sync — pushes local memories to a shared Supabase/Vercel backend so multiple Claude Code instances can share context.

## Why "Engram"

An engram is the physical trace a memory leaves in the brain — a structural change in neural tissue first theorized by Richard Semon in 1904. Every experience encodes itself; every recall reactivates that encoding. The name fits this project at two levels: locally, every Claude Code session leaves an engram in a SQLite database — observations and summaries that future sessions reactivate. At the team level, this fork adds a shared engram: memory traces propagate across machines so multiple agents draw from the same encoded history. The original claude-mem names itself after its mechanism. Engram names itself after the thing being formed.

---

## What's different from claude-mem

| Feature | claude-mem | engram |
|---------|-----------|--------|
| Local memory (SQLite) | ✓ | ✓ |
| Chroma vector search | ✓ | ✓ |
| Multi-agent sync | — | ✓ |
| Shared team memory | — | ✓ |
| Data directory | `~/.claude-mem/` | `~/.engram/` |

Everything else (hooks, worker, MCP tools, skills) is identical to the upstream.

---

## End-user install

1. Install via git URL:

   ```bash
   claude plugin install https://github.com/tsantana84/engram
   ```

2. Claude Code runs the setup wizard automatically on install. When prompted:
   - Enter your API key (contact Thiago to get one)
   - Enter an agent name (e.g. `thiago-macbook` — identifies this machine in shared memory)

3. Done. Observations sync to the shared server after each session.

---

## Developer setup

### Prerequisites

- [Bun](https://bun.sh) — `curl -fsSL https://bun.sh/install | bash`
- [Node.js](https://nodejs.org) ≥ 18
- [uv](https://docs.astral.sh/uv/) — for Chroma (auto-installed on first run)

### Clone and install

```bash
git clone https://github.com/tsantana84/engram
cd engram
npm install
```

### Build and run

```bash
npm run build-and-sync    # compile TypeScript + sync to installed plugin + restart worker
npm run worker:start      # start worker manually (if not running)
npm run worker:status     # check worker health
```

### Dev workflow

After editing TypeScript source:

```bash
npm run build-and-sync
```

This:
1. Compiles `src/` → `plugin/scripts/worker-service.cjs` (and other bundles)
2. Copies `plugin/` → `~/.claude/plugins/marketplaces/thedotmack/`
3. Triggers a worker restart

The installed plugin at `~/.claude/plugins/marketplaces/thedotmack/` is what Claude Code actually uses. Changes to `src/` only take effect after running `build-and-sync`.

---

## Key npm scripts

| Script | What it does |
|--------|-------------|
| `npm run build-and-sync` | Full rebuild + sync to installed plugin |
| `npm run worker:start` | Start the background worker |
| `npm run worker:stop` | Stop the worker |
| `npm run worker:restart` | Soft restart (via HTTP shutdown) |
| `npm run worker:force-restart` | Hard restart (kill by PID) — use after settings changes |
| `npm run worker:status` | Health check |
| `npm run worker:logs` | Tail worker logs (last 50 lines) |
| `npm run worker:tail` | Live tail worker logs |
| `npm test` | Run test suite |

---

## Settings

Settings file: `~/.engram/settings.json`

Created automatically on first run. Key sync settings:

```json
{
  "CLAUDE_MEM_SYNC_ENABLED": "true",
  "CLAUDE_MEM_SYNC_SERVER_URL": "https://engram-ashy.vercel.app",
  "CLAUDE_MEM_SYNC_API_KEY": "your-api-key",
  "CLAUDE_MEM_SYNC_AGENT_NAME": "your-machine-name"
}
```

After changing settings manually, run:

```bash
npm run worker:force-restart
```

> **Note:** All boolean settings must be strings (`"true"` not `true`). The worker normalizes them on load, but use strings in the JSON to be safe.

---

## Sync architecture

```
Claude Code session
  ↓ PostToolUse hook
Worker (port 37777)
  ↓ storeObservations()
SQLite (~/.engram/claude-mem.db)
  ↓ sync_queue (enqueue)
SyncWorker (every 30s)
  ↓ SyncClient.push()
Vercel API (https://engram-ashy.vercel.app)
  ↓
Supabase (shared team DB)
```

Sync is non-blocking — if the server is unreachable, observations are queued and retried (up to 5 attempts, then marked failed).

---

## Data directory

All data lives at `~/.engram/`:

```
~/.engram/
  claude-mem.db          # SQLite database (observations, sessions, sync_queue)
  settings.json          # Configuration
  logs/                  # Worker logs (claude-mem-YYYY-MM-DD.log)
  chroma/                # Vector embeddings
  corpora/               # Knowledge agent corpora
```

### Migrating from claude-mem

If you previously used the original claude-mem plugin, the setup wizard offers to migrate:

```
Engram detected existing claude-mem data at ~/.claude-mem
Migrate your existing memory data to ~/.engram? [Y/n]:
```

Or manually:

```bash
cp -r ~/.claude-mem ~/.engram
# Then update CLAUDE_MEM_DATA_DIR in ~/.engram/settings.json to ~/.engram
```

---

## Plugin identity

This plugin registers as `engram@thedotmack` in Claude Code. If you need to disable it:

```json
// ~/.claude/settings.json
{
  "enabledPlugins": {
    "engram@thedotmack": false
  }
}
```

---

## Upstream sync

This fork tracks upstream claude-mem. To pull upstream changes:

```bash
git remote add upstream https://github.com/thedotmack/claude-mem
git fetch upstream
git merge upstream/main
# Resolve conflicts (mainly: .claude-mem → .engram renames, sync pipeline additions)
npm run build-and-sync
```

Key divergence points to watch for in merges:
- `src/shared/EnvManager.ts` — data dir path
- `src/services/infrastructure/ProcessManager.ts` — data dir path
- `src/services/sqlite/SessionStore.ts` — sync_queue enqueue calls in `storeObservations()`
- `src/services/worker-service.ts` — SyncWorker initialization + force-restart command
- `plugin/hooks/hooks.json` — cache fallback paths (`engram` not `claude-mem`)
- `plugin/scripts/bun-runner.js` — plugin key (`engram@thedotmack`)

---

## Vercel backend

The sync server is deployed at `https://engram-ashy.vercel.app`.

API routes live in `api/` (Vercel serverless functions). Supabase schema is in `supabase/migrations/`.

To deploy backend changes:

```bash
vercel --prod
```

---

## Contact

API keys and team access: contact Thiago (@thedotmack).
