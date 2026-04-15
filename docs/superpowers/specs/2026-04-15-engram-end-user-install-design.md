# Engram End-User Install Experience — Design

**Date:** 2026-04-15
**Status:** Approved
**Scope:** Option B — proper rename + clean install path for end users

## Problem

Engram is a fork of claude-mem that adds multi-agent sync via Supabase. A new user who installs via git URL currently cannot get it working without manual file edits:

1. `hooks.json` cache fallback is hardcoded to `claude-mem` — not found for git URL installs, so hooks silently fail
2. No setup wizard — sync credentials require manually editing `~/.claude-mem/settings.json`
3. Data dir `~/.claude-mem/` conflicts with users who have the original claude-mem plugin
4. Settings parser doesn't normalize boolean vs string for `SYNC_ENABLED`
5. `worker:restart` doesn't actually restart a running worker

## Goals

- A new user installs via git URL, gets prompted for their API key, and sync works — zero manual file edits
- Engram has a clean, self-consistent identity (no residual `claude-mem` references in config)
- Existing users with data at `~/.claude-mem/` are offered a migration path
- Developer workflow (`build-and-sync`, restart) is reliable

## Out of Scope

- Custom Supabase/Vercel backend deployment (users connect to the shared server)
- Advanced settings UI (model selection, Chroma config, etc.)
- Claude Code marketplace listing

---

## Section 1: Rename & Identity Cleanup

Every file in the repo must consistently refer to `engram`, not `claude-mem`.

### `plugin/hooks/hooks.json`

All 6 hook commands contain a cache fallback:
```sh
ls -dt $HOME/.claude/plugins/cache/thedotmack/claude-mem/[0-9]*/
```
Change to:
```sh
ls -dt $HOME/.claude/plugins/cache/thedotmack/engram/[0-9]*/
```

This is the critical fix. Without it, hooks fall back to a path that doesn't exist for git URL installs.

### `package.json`

- npm bin: `"claude-mem"` → `"engram"`
- `repository.url`, `homepage`, `bugs.url`: update to engram repo URL
- `scripts.worker:logs` and `worker:tail`: `~/.claude-mem/logs/worker-*` → `~/.engram/logs/worker-*`

### `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`

- `repository` and `homepage` URLs: update to engram repo

### `plugin/scripts/bun-runner.js` (dev source)

Already updated to check `engram@thedotmack`. No change needed.

---

## Section 2: Data Directory — `~/.claude-mem/` → `~/.engram/`

### Why

Users who had the original claude-mem installed share the `~/.claude-mem/` directory. Engram must use `~/.engram/` to avoid conflicts.

### What changes

- Default value of `CLAUDE_MEM_DATA_DIR` setting: `~/.claude-mem` → `~/.engram`
- All hardcoded references to `~/.claude-mem/` in scripts and documentation

### Migration (for existing users)

The setup wizard (Section 3) checks on first run:
- If `~/.engram/` does not exist AND `~/.claude-mem/` exists → offer to copy: `cp -r ~/.claude-mem ~/.engram`
- If user accepts: copies data, sets `CLAUDE_MEM_DATA_DIR` to `~/.engram`
- If user declines: starts fresh at `~/.engram`
- If `~/.engram/` already exists: skip migration silently

---

## Section 3: Setup Wizard

### Location

`plugin/scripts/setup.sh` — already called by the Setup hook on every session start.

### Behavior

The wizard is **idempotent**: if sync is already configured (API key present in settings), it exits 0 silently.

**First-run flow:**
```
1. Check if ~/.engram/settings.json has CLAUDE_MEM_SYNC_API_KEY set
2. If yes → exit 0 (silent)
3. If no:
   a. Run migration check (Section 2)
   b. Print welcome message
   c. Prompt: "Enter your engram API key:"
   d. Prompt: "Enter an agent name [default: <hostname>]:"
   e. Write to ~/.engram/settings.json:
      - CLAUDE_MEM_SYNC_ENABLED: "true"
      - CLAUDE_MEM_SYNC_SERVER_URL: "https://engram-ashy.vercel.app"
      - CLAUDE_MEM_SYNC_API_KEY: <entered key>
      - CLAUDE_MEM_SYNC_AGENT_NAME: <entered name>
   f. Print: "Engram configured. Observations will sync after each session."
```

**What the wizard does NOT ask:**
- Model selection, Chroma config, provider, advanced options — all use defaults.

**Timeout behavior:**
The Setup hook has a 300s timeout. The wizard should complete in under 30s or time out gracefully (exit 0, not exit 1).

---

## Section 4: Settings Parser Normalization

### Problem

`worker-service.ts` already handles both `=== true` and `=== "true"` for `SYNC_ENABLED`. However, if someone manually edits `settings.json` and writes `true` (bare boolean), the settings writer on next save may not normalize it.

### Fix

Add a normalization pass in the settings loader (`SettingsManager` or equivalent): after reading `settings.json`, coerce any boolean values to their string equivalents:
```typescript
if (value === true) return "true";
if (value === false) return "false";
```

The setup wizard always writes string values, so this is purely defensive for manual edits.

---

## Section 5: Worker Restart

### Problem

`npm run worker:restart` sends a soft restart signal. If a worker process is alive, it skips spawning and does nothing — so settings changes are never picked up without manually killing the PID.

### Fix

Add a `force-restart` command to `worker-service.cjs`:
1. Read PID file at `~/.engram/worker.pid`
2. If PID is alive: send `SIGTERM`, wait up to 2s
3. Start fresh worker process

```json
"worker:force-restart": "bun plugin/scripts/worker-service.cjs force-restart"
```

The existing `worker:restart` command stays unchanged (used by `build-and-sync`'s soft restart). The new `force-restart` is for when settings changes need to be picked up immediately.

---

## Section 6: README

The public README install section:

```markdown
## Install

1. Install the plugin:
   ```
   claude plugin install https://github.com/<org>/engram
   ```

2. Start or reload Claude Code. The setup wizard runs automatically.
   When prompted:
   - Enter your API key (get one from Thiago)
   - Enter an agent name (e.g. "thiago-macbook" — identifies this machine)

3. Done. Observations sync to the shared server after each session.

## Updating

```
npm run build-and-sync
```
```

No mention of internal file paths. The only manual step is the API key, handled interactively.

---

## Implementation Checklist

| # | File | Change |
|---|------|--------|
| 1 | `plugin/hooks/hooks.json` | Fix 6 cache fallback paths: `claude-mem` → `engram` |
| 2 | `package.json` | Rename bin, URLs, log paths |
| 3 | `.claude-plugin/plugin.json` | Update repo URLs |
| 4 | `.claude-plugin/marketplace.json` | Update homepage URL |
| 5 | `plugin/scripts/setup.sh` | Replace with interactive wizard |
| 6 | `src/services/worker/SettingsManager.ts` (or equivalent) | Add boolean→string normalization on settings load |
| 7 | `plugin/scripts/worker-service.cjs` + source | Add `force-restart` command |
| 8 | Default `CLAUDE_MEM_DATA_DIR` value | `~/.claude-mem` → `~/.engram` |
| 9 | `README.md` | Clean 3-step install guide |

## Success Criteria

- New user clones repo, installs via `claude plugin install <url>`, starts Claude Code, is prompted for API key, enters it, and observations sync to the server — no manual file edits required
- Existing user with `~/.claude-mem/` data is offered migration and their history carries over
- `npm run worker:force-restart` reliably picks up new settings
- All `claude-mem` references removed from hook commands and config files
