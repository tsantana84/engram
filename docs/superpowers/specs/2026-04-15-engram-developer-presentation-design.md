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

## Timing Notes

Total allocated: 30 min (3+8+7+7+3+2). No buffer built in. Mitigate by pre-staging the demo before the talk: plugin already installed, worker already running, viewer already open at `http://127.0.0.1:37777`. Slide 4 becomes a narrated walkthrough rather than a live install — cuts demo risk to near-zero and creates a natural 3–4 min buffer across transitions.

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

Data flow (stepped/animated — each arrow reveals on right-arrow keypress):
```
PostToolUse hook
  ↓
Worker (port 37777) — SessionStore.ts
  ↓ storeObservations()
SQLite (~/.engram/claude-mem.db)          ← filename unchanged from upstream; dir renamed
  git_branch, invalidated_at, validation_status captured here
  ↓ sync_queue enqueue
SyncWorker (every 30s) — SyncWorker.ts
  ↓
ConflictDetector — ConflictDetector.ts    ← opt-in; disabled when no LLM provider configured
  ↓ classification result
SyncClient.push() — SyncClient.ts
  ↓
Vercel API (https://engram-ashy.vercel.app) — api/sync.ts
  ↓
Supabase (shared team DB)                 ← scoped per API key; no cross-team data access
```

Key callouts:
- Sync is **non-blocking** — queue retries up to 5×, marks failed after that
- Provenance captured at write time: `git_branch`, `invalidated_at`, `validation_status`
- Worker runs at `http://localhost:37777` — viewer UI at `http://127.0.0.1:37777`
- ConflictDetector is opt-in: no provider configured = all observations pass as ADD

---

### Slide 3 — ConflictDetector deep-dive (7 min)

**Purpose:** The "memory quality" problem and its solution.

**The problem:** Stale or wrong observations (e.g., written while debugging a false hypothesis, or on an unmerged branch) pollute the shared brain and mislead other agents.

**Pipeline (when `CLAUDE_MEM_PROVIDER` is set in `~/.engram/settings.json`):**
1. Fetch top-5 semantically similar observations from Supabase
2. Pass to LLM with structured classification prompt
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

**Safe default:** `CLAUDE_MEM_PROVIDER` not set = ConflictDetector disabled, all observations pass as ADD.

---

### Slide 4 — Demo walkthrough (7 min)

**Purpose:** Prove it works. Narrated walkthrough of a pre-staged environment.

**Pre-stage before the talk:**
```bash
claude plugin marketplace add tsantana84/engram
claude plugin install engram
# Restart Claude Code, run /login, enter agent name
# Verify: npm run worker:status
```

**Narrate live (plugin already installed):**
- Worker logs: `npm run worker:tail` — show observations flowing in during a real prompt
- Viewer UI: `http://127.0.0.1:37777` — real-time memory stream
- SQLite sync_queue: `sqlite3 ~/.engram/claude-mem.db "SELECT * FROM sync_queue LIMIT 10"`
- Optional: point to a log line showing a ConflictDetector INVALIDATE action

**If worker or viewer breaks mid-demo:** switch to slides — the architecture diagram on Slide 2 is sufficient to explain the flow without live proof.

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

Note: upstream claude-mem commits can be cherry-picked individually, but any commit touching the above files will require manual conflict resolution.

**Backend deploy:**
```bash
vercel --prod
```

**API keys + team access:** contact Thiago (@thedotmack)

---

### Slide 6 — Q&A (2 min)

**Backup FAQ slides:** hidden `<div>` sections in the HTML deck, revealed by pressing `F` key. Pre-built for these common questions:

- *"What about private/sensitive content?"* → `<private>` tags strip content before storage
- *"What if Supabase is down?"* → Sync queue retries 5×, then marks failed. Local memory unaffected.
- *"Migrating from claude-mem?"* → Setup wizard offers migration, or manual `cp -r ~/.claude-mem ~/.engram`
- *"How do I disable sync?"* → `"CLAUDE_MEM_SYNC_ENABLED": "false"` in `~/.engram/settings.json`
- *"Who can see my observations?"* → Scoped per API key. Your key = your team's data only.

---

## Implementation Notes

**Reference file:** Before building, open `docs/presentations/multi-agent-sync-team.html` in a browser to inspect the existing style — navigation, typography, color scheme, code block treatment. The new deck must match it structurally. No external CSS or JS frameworks; everything inline.

**Navigation:** Left/right arrow keys advance slides. Each slide is a `<section>` with `display:none`; active slide gets `display:block`. Current slide index tracked in JS.

**Architecture diagram (Slide 2):** Each row of the data flow renders as a `<div>` with `opacity:0`. Right-arrow keypress triggers the next row to fade in (`opacity:1`, CSS transition 300ms). Implement as a sub-step within Slide 2's slide state.

**Code blocks:** `<pre>` with `font-family: monospace`, dark background, no external syntax highlighter. Match style of reference file.

**FAQ reveal (Slide 6):** Press `F` on Slide 6 to toggle a `<div class="faq-panel">` overlay containing all FAQ items. Press `F` or `Escape` to dismiss.

**Offline:** No CDN links. All fonts, styles, scripts inline or system fonts.

**Output:** `docs/presentations/engram-developer-talk.html`
