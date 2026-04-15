# Engram End-User Install Experience — Design

**Date:** 2026-04-15
**Status:** Approved
**Scope:** Option B — proper rename + clean install path for end users

## Problem

Engram is a fork of claude-mem that adds multi-agent sync via Supabase/Vercel. A new user who installs via git URL currently cannot get it working without manual file edits:

1. `hooks.json` cache fallback is hardcoded to `claude-mem` — not found for git URL installs, so hooks silently fail
2. No setup wizard — sync credentials require manually editing `~/.claude-mem/settings.json`
3. Data dir `~/.claude-mem/` conflicts with users who have the original claude-mem plugin
4. Settings parser doesn't normalize boolean vs string for `SYNC_ENABLED`
5. `worker:restart` doesn't actually restart a running worker
6. Multiple source files hardcode `~/.claude-mem/` independently of the `CLAUDE_MEM_DATA_DIR` setting

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

All hook commands (Setup, SessionStart ×3, UserPromptSubmit, PostToolUse, Stop, SessionEnd — 8 total; PreToolUse already correct) contain a cache fallback:
```sh
ls -dt $HOME/.claude/plugins/cache/thedotmack/claude-mem/[0-9]*/
```
Change to:
```sh
ls -dt $HOME/.claude/plugins/cache/thedotmack/engram/[0-9]*/
```

This is the critical fix. Without it, hooks fall back to a path that doesn't exist for git URL installs, causing all hooks to silently fail.

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

Users who have the original claude-mem plugin share the `~/.claude-mem/` directory. Engram must use `~/.engram/` to avoid conflicts.

### Hardcoded paths to update

The data dir is not only in the `CLAUDE_MEM_DATA_DIR` default — it is hardcoded in at least 5 additional files that must all be updated:

| File | Location | Hardcoding |
|------|----------|------------|
| `src/shared/EnvManager.ts` | line 18 | `DATA_DIR = join(homedir(), '.claude-mem')` — reads `.env` file for API key; **critical**: if not updated, auth breaks after migration |
| `src/shared/SettingsDefaultsManager.ts` | `CLAUDE_MEM_TRANSCRIPTS_CONFIG_PATH` default | `~/.claude-mem/transcript-watch.json` |
| `src/services/transcripts/config.ts` | lines 6–7 | `DEFAULT_CONFIG_PATH` and `DEFAULT_STATE_PATH` |
| `src/cli/claude-md-commands.ts` | lines 30–31 | `DB_PATH` and `SETTINGS_PATH` |
| `src/utils/logger.ts` | line 29 | `DEFAULT_DATA_DIR` |

**Approach:** Change each hardcoded `'.claude-mem'` to `'.engram'`. Do not make them dynamic readers of `CLAUDE_MEM_DATA_DIR` — that would require threading the settings object to places that currently don't need it. A simple string replacement is correct here.

### Migration (for existing users)

The setup wizard (Section 3) checks on first run:

1. If `~/.engram/` does not exist AND `~/.claude-mem/` exists:
   - Offer to copy: `cp -r ~/.claude-mem ~/.engram`
   - After copying, **explicitly overwrite** `CLAUDE_MEM_DATA_DIR` in `~/.engram/settings.json` to `~/.engram` (the copied settings.json still says `~/.claude-mem`, which would cause the worker to re-read the old location)
2. If user declines: start fresh at `~/.engram`
3. If `~/.engram/` already exists: skip silently

---

## Section 3: Setup Wizard

### Location

`plugin/scripts/setup.sh` — **this file does not yet exist and must be created from scratch**. It is already referenced in the Setup hook command (`"$_R/scripts/setup.sh"`), so Claude Code will call it once the file exists.

### When it runs

The Setup hook fires **once during plugin install or update**, not on every session start. The SessionStart hook is separate and does not call `setup.sh`. This is the correct trigger for first-run configuration.

### Behavior

The wizard is **idempotent**: if sync is already configured (API key present in `~/.engram/settings.json`), it exits 0 silently.

**First-run flow:**
```
0. Guard: if stdin is not a TTY (headless install), exit 0 immediately
   [ -t 0 ] || exit 0

1. Check if ~/.engram/settings.json has CLAUDE_MEM_SYNC_API_KEY set (non-empty)
   → If yes: exit 0 (silent, already configured)

2. Run migration check:
   - If ~/.engram/ missing AND ~/.claude-mem/ exists:
     → Prompt: "Migrate existing data from ~/.claude-mem to ~/.engram? [Y/n]"
     → If yes: cp -r ~/.claude-mem ~/.engram
               then patch CLAUDE_MEM_DATA_DIR in ~/.engram/settings.json to ~/.engram
               Use `node -e` for the JSON patch (no jq dependency; Node.js is already required):
               node -e "const f='$HOME/.engram/settings.json',d=JSON.parse(require('fs').readFileSync(f));d.CLAUDE_MEM_DATA_DIR=d.CLAUDE_MEM_DATA_DIR.replace('.claude-mem','.engram');require('fs').writeFileSync(f,JSON.stringify(d,null,2))"
     → If no: mkdir -p ~/.engram

3. Print welcome message

4. Prompt: "Enter your engram API key:"
   (user obtains from Thiago)

5. Prompt: "Enter an agent name [default: $(hostname)]:"
   (identifies this machine in the shared memory server)

6. Write to ~/.engram/settings.json:
   CLAUDE_MEM_SYNC_ENABLED: "true"
   CLAUDE_MEM_SYNC_SERVER_URL: "https://engram-ashy.vercel.app"
   CLAUDE_MEM_SYNC_API_KEY: <entered key>
   CLAUDE_MEM_SYNC_AGENT_NAME: <entered name or hostname>

7. Print: "Engram configured. Observations will sync after each session."
   exit 0
```

**What the wizard does NOT ask:**
Model selection, Chroma config, provider, advanced options — all use defaults.

**Timeout/TTY:**
- Guard at the top: `[ -t 0 ] || exit 0` — exits silently if no TTY (headless/CI)
- The Setup hook has a 300s timeout; the wizard must complete in under 30s under normal conditions

---

## Section 4: Settings Parser Normalization

### Problem

`worker-service.ts` already handles both `=== true` and `=== "true"` for `SYNC_ENABLED`. However, if someone manually edits `settings.json` and writes bare `true` (boolean), the value passes through `loadFromFile()` in `SettingsDefaultsManager.ts` without coercion since the merge loop at line 269 does `result[key] = flatSettings[key]` with no type check.

### Fix

Inside `loadFromFile()` in `src/shared/SettingsDefaultsManager.ts`, at the merge loop (line ~269), add coercion before assignment:

```typescript
const raw = flatSettings[key];
result[key] = (raw === true) ? 'true' : (raw === false) ? 'false' : raw;
```

This is a one-line guard. The setup wizard always writes string values, so this is purely defensive for manual edits.

**Note:** Any code that writes `CLAUDE_MEM_SYNC_ENABLED: true` (boolean) as an example or default (e.g. `server.ts` line 35) must also be updated to write `"true"` (string) — otherwise the bug will be immediately reproduced.

---

## Section 5: Worker Restart

### Problem

`npm run worker:restart` sends a soft restart signal. If a worker process is alive with the same PID, it skips spawning — settings changes are not picked up without manually killing the PID.

### Fix

Add a `force-restart` command to `worker-service.cjs` source (`src/services/worker-service.ts`):

1. Read `CLAUDE_MEM_DATA_DIR` from settings (not hardcoded path) to locate the PID file: `<dataDir>/worker.pid`
2. If PID is alive: send `SIGTERM`, wait up to 2s
3. Start fresh worker process

The PID file path must be derived from `CLAUDE_MEM_DATA_DIR` — do not hardcode `~/.engram/worker.pid`, which would break for users with a non-default data dir.

```json
"worker:force-restart": "bun plugin/scripts/worker-service.cjs force-restart"
```

The existing `worker:restart` (used by `build-and-sync`) stays unchanged.

---

## Section 6: README

The public README install section:

```markdown
## Install

1. Install the plugin:
   ```
   claude plugin install https://github.com/<org>/engram
   ```

2. Claude Code will run the setup wizard automatically.
   When prompted:
   - Enter your API key (get one from Thiago)
   - Enter an agent name (e.g. "thiago-macbook" — identifies this machine)

3. Done. Observations sync to the shared server after each session.

## Updating

npm run build-and-sync
```

No mention of internal file paths. The only manual step is the API key, handled interactively.

---

## Implementation Checklist

| # | File(s) | Change |
|---|---------|--------|
| 1 | `plugin/hooks/hooks.json` | Fix 8 cache fallback paths: `claude-mem` → `engram` |
| 2 | `package.json` | Rename bin, URLs, log paths |
| 3 | `.claude-plugin/plugin.json` + `marketplace.json` | Update repo URLs |
| 4 | `src/shared/EnvManager.ts` line 18 | `.claude-mem` → `.engram` **(auth-critical)** |
| 5 | `src/shared/SettingsDefaultsManager.ts` | Default data dir + TRANSCRIPTS_CONFIG_PATH default |
| 6 | `src/services/transcripts/config.ts` lines 6–7 | `.claude-mem` → `.engram` |
| 7 | `src/cli/claude-md-commands.ts` lines 30–31 | `.claude-mem` → `.engram` |
| 8 | `src/utils/logger.ts` line 29 | `.claude-mem` → `.engram` |
| 8a | `src/services/infrastructure/ProcessManager.ts` line 24 | `.claude-mem` → `.engram` **(PID file — breaks force-restart if missed)** |
| 8b | `src/supervisor/shutdown.ts` line 11 | `.claude-mem` → `.engram` |
| 8c | `src/supervisor/index.ts` line 24 | `.claude-mem` → `.engram` |
| 9 | `src/shared/SettingsDefaultsManager.ts` ~line 269 | Boolean→string normalization in `loadFromFile()` merge loop |
| 10 | `src/npx-cli/commands/server.ts` line 35 | Changes `CLAUDE_MEM_SYNC_ENABLED: true` (boolean) → `"true"` string in generated user-facing output |
| 11 | `plugin/scripts/setup.sh` | **Create from scratch** — interactive wizard (API key + agent name + migration) |
| 12 | `src/services/worker-service.ts` | Add `force-restart` command using settings-derived PID path |
| 13 | `README.md` | Clean 3-step install guide |

## Success Criteria

- New user installs via `claude plugin install <url>`, starts Claude Code, is prompted for API key, enters it, and observations sync to the server — no manual file edits required
- TTY guard (`[ -t 0 ] || exit 0`) prevents wizard from hanging in headless installs
- Existing user with `~/.claude-mem/` data is offered migration; after migration `CLAUDE_MEM_DATA_DIR` in `~/.engram/settings.json` points to `~/.engram` (not the copied `~/.claude-mem` value)
- `npm run worker:force-restart` reliably picks up new settings
- All `claude-mem` references removed from hook commands and config files
- Auth works after migration (`EnvManager` reads `.env` from `~/.engram/`)
