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

## How It Works

## Dev Guide
