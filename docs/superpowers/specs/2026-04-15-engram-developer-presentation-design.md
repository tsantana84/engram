# Engram Developer Presentation — Design Spec

**Date:** 2026-04-15  
**Author:** Thiago Santana  
**Status:** Approved

---

## Context

Engram is a fork of claude-mem (v12.1.0) that adds multi-agent sync via Supabase/Vercel. This document specifies a 30-minute live developer presentation targeting Cint team developers.

---

## Audience

Cint engineering team. Familiarity with Claude Code assumed. No intro to LLMs needed. Goal is to transfer architectural understanding and enable independent installation and potential contribution.

---

## Format

- **Delivery:** Live talk with HTML slide deck + terminal demo
- **Duration:** ~30 minutes
- **Slide deck output:** `docs/presentations/engram-developer-talk.html` (matching existing presentation style)
- **Approach:** Architecture-first — diagram before motivation, demo proves it works

---

## Slide Structure

### Slide 1 — What is engram? (3 min)

**Purpose:** Vocabulary-setting. No pitch.

Content:
- One-liner: "fork of claude-mem that adds multi-agent sync"
- Feature diff table:

| Feature | claude-mem | engram |
|---------|-----------|--------|
| Local memory (SQLite) | ✓ | ✓ |
| Chroma vector search | ✓ | ✓ |
| Multi-agent sync | — | ✓ |
| Shared team memory | — | ✓ |
| Data directory | `~/.claude-mem/` | `~/.engram/` |

- Plugin identity: `engram@thedotmack`

---

### Slide 2 — Full data flow (8 min)

**Purpose:** The architectural anchor. Every subsequent slide refers back to this.

Data flow (stepped/animated):
```
PostToolUse hook
  ↓
Worker (port 37777) — SessionStore.ts
  ↓ storeObservations()
SQLite (~/.engram/claude-mem.db)
  git_branch, invalidated_at, validation_status captured here
  ↓ sync_queue enqueue
SyncWorker (every 30s) — SyncWorker.ts
  ↓
ConflictDetector — ConflictDetector.ts
  ↓ classification result
SyncClient.push() — SyncClient.ts
  ↓
Vercel API (https://engram-ashy.vercel.app) — api/sync.ts
  ↓
Supabase (shared team DB)
```

Key callouts:
- Sync is **non-blocking** — queue retries up to 5×, marks failed after that
- Provenance captured at write time: `git_branch`, `invalidated_at`, `validation_status`
- Worker runs at `http://localhost:37777` — viewer UI at `http://127.0.0.1:37777`

---

### Slide 3 — ConflictDetector deep-dive (7 min)

**Purpose:** The "memory quality" problem and its solution.

**The problem:** Stale or wrong observations (e.g., written while debugging a false hypothesis, or on an unmerged branch) pollute the shared brain and mislead other agents.

**Pipeline:**
1. Fetch top-5 semantically similar observations from Supabase
2. Pass to LLM (routed via `CLAUDE_MEM_PROVIDER`) with structured prompt
3. Get back one of four actions:

| Action | Meaning |
|--------|---------|
| **ADD** | New info, no conflict — store normally |
| **UPDATE** | Supersedes existing — store new, invalidate old |
| **INVALIDATE** | Contradicts existing that appears wrong — invalidate old, store new |
| **NOOP** | Duplicate or adds no value — drop |

**Provenance columns (observations table):**

| Column | Type | Purpose |
|--------|------|---------|
| `git_branch` | TEXT | Branch active at write time — flags observations from unmerged branches |
| `invalidated_at` | INTEGER | Epoch when superseded (NULL = still valid) |
| `validation_status` | TEXT | `unvalidated` / `validated` / `invalidated` |

**What gets filtered:**
- `invalidated_at IS NOT NULL` → excluded from context injection
- Team search results include `unvalidated: true` flag for observations from unmerged branches

**Safe default:** No provider configured = conflict detection disabled, all observations pass as ADD.

---

### Slide 4 — Live demo (7 min)

**Purpose:** Prove it works. Visceral confirmation of the architecture just shown.

**Demo script:**
```bash
# Install
claude plugin marketplace add tsantana84/engram
claude plugin install engram
# Restart Claude Code
# In Claude Code:
/login
# → Enter agent name (e.g. "macbook-thiago")
# → Machine registered, sync configured
```

**Show:**
- Worker logs: `npm run worker:tail`
- Viewer UI: `http://127.0.0.1:37777`
- SQLite sync_queue flush (optional: `sqlite3 ~/.engram/claude-mem.db "SELECT * FROM sync_queue LIMIT 10"`)
- Optional: write contradictory observation, show INVALIDATE action in logs

**Fallback if install breaks:** Pre-recorded terminal session gif.

---

### Slide 5 — Dev workflow + contributing (3 min)

**Purpose:** Enable contribution and maintenance.

**Edit cycle:**
```bash
# Edit src/
npm run build-and-sync  # compile → sync to installed plugin → restart worker
npm test                # run test suite
```

**Key files:**
| File | Role |
|------|------|
| `src/services/sqlite/SessionStore.ts` | SQLite layer, sync_queue enqueue |
| `src/services/sync/SyncWorker.ts` | 30s sync loop |
| `src/services/sync/ConflictDetector.ts` | LLM-based conflict classification |
| `src/services/sync/SyncClient.ts` | Vercel API client |
| `api/sync.ts` | Vercel serverless function |

**Upstream merge — divergence points to watch:**
- `src/shared/EnvManager.ts` — data dir path
- `src/services/sqlite/SessionStore.ts` — sync_queue enqueue calls
- `src/services/worker-service.ts` — SyncWorker initialization
- `plugin/scripts/bun-runner.js` — plugin key (`engram@thedotmack`)

**Backend deploy:**
```bash
vercel --prod
```

**API keys + team access:** contact Thiago (@thedotmack)

---

### Slide 6 — Q&A (2 min)

**Backup FAQ slides (pre-built, reveal on demand):**
- *"What about private/sensitive content?"* → `<private>` tags strip content before storage
- *"What if Supabase is down?"* → Sync queue retries 5×, then marks failed. Local memory unaffected.
- *"Migrating from claude-mem?"* → Setup wizard offers migration, or manual `cp -r ~/.claude-mem ~/.engram`
- *"How do I disable sync?"* → `"CLAUDE_MEM_SYNC_ENABLED": "false"` in `~/.engram/settings.json`

---

## Implementation Notes

- Slide deck format: single HTML file, self-contained, keyboard-navigable (matching `multi-agent-sync-team.html` style)
- Architecture diagram in Slide 2: SVG or HTML/CSS-rendered, stepped reveal on keypress
- No external dependencies — deck works offline
- Save to: `docs/presentations/engram-developer-talk.html`
