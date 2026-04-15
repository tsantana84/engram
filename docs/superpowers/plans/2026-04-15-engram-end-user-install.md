# Engram End-User Install Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make engram installable via a single git URL with zero manual file edits — plugin identity is fully renamed from claude-mem, data lives at `~/.engram/`, and a setup wizard configures sync credentials on first run.

**Architecture:** Simple string replacements for the rename/data-dir changes; a new `setup.sh` wizard handles first-run onboarding; a `force-restart` case is added to the existing `switch(command)` in `worker-service.ts`. All changes are independent and can be committed task-by-task.

**Tech Stack:** TypeScript (worker-service, SettingsDefaultsManager), Bash (setup.sh, hooks.json), JSON (package.json, .claude-plugin configs)

**Spec:** `docs/superpowers/specs/2026-04-15-engram-end-user-install-design.md`

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `plugin/hooks/hooks.json` | Modify | 8 cache fallback paths: `claude-mem` → `engram` |
| `package.json` | Modify | bin name, URLs, log paths |
| `.claude-plugin/plugin.json` | Modify | repo/homepage URLs |
| `.claude-plugin/marketplace.json` | Modify | homepage URL |
| `src/shared/EnvManager.ts` | Modify | DATA_DIR `.claude-mem` → `.engram` |
| `src/shared/SettingsDefaultsManager.ts` | Modify | Default data dir, TRANSCRIPTS default, boolean normalization |
| `src/services/transcripts/config.ts` | Modify | DEFAULT_CONFIG_PATH, DEFAULT_STATE_PATH |
| `src/cli/claude-md-commands.ts` | Modify | DB_PATH, SETTINGS_PATH |
| `src/utils/logger.ts` | Modify | DEFAULT_DATA_DIR |
| `src/services/infrastructure/ProcessManager.ts` | Modify | DATA_DIR `.claude-mem` → `.engram` |
| `src/supervisor/shutdown.ts` | Modify | DATA_DIR `.claude-mem` → `.engram` |
| `src/supervisor/index.ts` | Modify | DATA_DIR `.claude-mem` → `.engram` |
| `src/npx-cli/commands/server.ts` | Modify | `CLAUDE_MEM_SYNC_ENABLED: true` → `"true"` |
| `src/services/worker-service.ts` | Modify | Add `force-restart` case |
| `plugin/scripts/setup.sh` | **Create** | Interactive first-run wizard |
| `README.md` | Modify | 3-step install guide |

---

## Task 1: Fix hooks.json cache fallback paths

The most critical fix. Eight hook commands contain `cache/thedotmack/claude-mem/` — Claude Code falls back to this path when `CLAUDE_PLUGIN_ROOT` isn't set. For git URL installs the cache lives at `cache/thedotmack/engram/`, so hooks silently fail without this fix.

**Files:**
- Modify: `plugin/hooks/hooks.json`

- [ ] **Step 1: Verify the current state (scope to the cache path pattern)**

```bash
grep -c "cache/thedotmack/claude-mem/" plugin/hooks/hooks.json
```
Expected: `8`

- [ ] **Step 2: Replace all cache fallback paths**

```bash
sed -i '' 's|cache/thedotmack/claude-mem/|cache/thedotmack/engram/|g' plugin/hooks/hooks.json
```

- [ ] **Step 3: Verify — no more cache fallback paths to claude-mem**

```bash
grep "cache/thedotmack/claude-mem/" plugin/hooks/hooks.json
```
Expected: zero matches

- [ ] **Step 4: Verify JSON is still valid**

```bash
python3 -m json.tool plugin/hooks/hooks.json > /dev/null && echo "valid"
```
Expected: `valid`

- [ ] **Step 5: Commit**

```bash
git add plugin/hooks/hooks.json
git commit -m "fix: update hooks.json cache fallback from claude-mem to engram"
```

---

## Task 2: Rename package.json and .claude-plugin config files

Update all plugin identity references so the plugin presents itself as `engram` everywhere.

**Files:**
- Modify: `package.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Update package.json bin name**

In `package.json`, find the `"bin"` section and rename the key:
```json
"bin": {
  "engram": "./dist/npx-cli/index.js"
}
```
(was `"claude-mem"`)

- [ ] **Step 2: Update package.json URLs and log paths**

In `package.json`:
- `"repository".url` → your engram GitHub URL
- `"homepage"` → your engram GitHub URL
- `"bugs".url` → your engram GitHub issues URL
- `scripts."worker:logs"`: replace `~/.claude-mem/logs/worker-` with `~/.engram/logs/worker-`
- `scripts."worker:tail"`: same replacement

- [ ] **Step 3: Update .claude-plugin/plugin.json**

Change `"repository"` and `"homepage"` values to your engram repo URL.

- [ ] **Step 4: Update .claude-plugin/marketplace.json**

Change `"homepage"` value to your engram repo URL.

- [ ] **Step 5: Verify JSON validity**

```bash
python3 -m json.tool package.json > /dev/null && echo "package.json valid"
python3 -m json.tool .claude-plugin/plugin.json > /dev/null && echo "plugin.json valid"
python3 -m json.tool .claude-plugin/marketplace.json > /dev/null && echo "marketplace.json valid"
```
Expected: all three print `valid`

- [ ] **Step 6: Commit**

```bash
git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "fix: rename plugin identity references from claude-mem to engram"
```

---

## Task 3: Rename data directory references in source files

Change every hardcoded `~/.claude-mem/` path to `~/.engram/` across 8 source files. These are all simple string replacements.

**Files:**
- Modify: `src/shared/EnvManager.ts` (line 18)
- Modify: `src/shared/SettingsDefaultsManager.ts` (lines 114, 135)
- Modify: `src/services/transcripts/config.ts` (lines 6–7)
- Modify: `src/cli/claude-md-commands.ts` (lines 30–31)
- Modify: `src/utils/logger.ts` (line 29)
- Modify: `src/services/infrastructure/ProcessManager.ts` (line 24)
- Modify: `src/supervisor/shutdown.ts` (line 11)
- Modify: `src/supervisor/index.ts` (line 9/24)
- Modify: `src/shared/paths.ts` (line 54 — cache path; line 59 — data dir)
- Modify: `src/npx-cli/utils/paths.ts` (line 59)
- Modify: `src/utils/claude-md-utils.ts` (line 21)
- Modify: `src/services/context/ContextConfigLoader.ts` (line 18)
- Modify: `src/services/sync/ChromaMcpManager.ts` (lines 31, 370)
- Modify: `src/services/integrations/CodexCliInstaller.ts` (line 35)

- [ ] **Step 1: Verify all current hardcoded paths**

```bash
grep -rn "\.claude-mem" src/ --include="*.ts" | grep -v "// \|comment\|test\|spec"
```
Expected: matches in the 8 files listed above and possibly a few more

- [ ] **Step 2: Replace in EnvManager.ts**

In `src/shared/EnvManager.ts` line 18:
```typescript
// Before:
const DATA_DIR = join(homedir(), '.claude-mem');
// After:
const DATA_DIR = join(homedir(), '.engram');
```

- [ ] **Step 3: Replace in SettingsDefaultsManager.ts**

In `src/shared/SettingsDefaultsManager.ts`:

Line ~114:
```typescript
// Before:
CLAUDE_MEM_DATA_DIR: join(homedir(), '.claude-mem'),
// After:
CLAUDE_MEM_DATA_DIR: join(homedir(), '.engram'),
```

Line ~135:
```typescript
// Before:
CLAUDE_MEM_TRANSCRIPTS_CONFIG_PATH: join(homedir(), '.claude-mem', 'transcript-watch.json'),
// After:
CLAUDE_MEM_TRANSCRIPTS_CONFIG_PATH: join(homedir(), '.engram', 'transcript-watch.json'),
```

- [ ] **Step 4: Replace in transcripts/config.ts**

In `src/services/transcripts/config.ts` lines 6–7:
```typescript
// Before:
export const DEFAULT_CONFIG_PATH = join(homedir(), '.claude-mem', 'transcript-watch.json');
export const DEFAULT_STATE_PATH = join(homedir(), '.claude-mem', 'transcript-watch-state.json');
// After:
export const DEFAULT_CONFIG_PATH = join(homedir(), '.engram', 'transcript-watch.json');
export const DEFAULT_STATE_PATH = join(homedir(), '.engram', 'transcript-watch-state.json');
```

- [ ] **Step 5: Replace in cli/claude-md-commands.ts**

In `src/cli/claude-md-commands.ts` lines 30–31:
```typescript
// Before:
const DB_PATH = path.join(os.homedir(), '.claude-mem', 'claude-mem.db');
const SETTINGS_PATH = path.join(os.homedir(), '.claude-mem', 'settings.json');
// After:
const DB_PATH = path.join(os.homedir(), '.engram', 'claude-mem.db');
const SETTINGS_PATH = path.join(os.homedir(), '.engram', 'settings.json');
```

- [ ] **Step 6: Replace in utils/logger.ts**

In `src/utils/logger.ts` line 29:
```typescript
// Before:
const DEFAULT_DATA_DIR = join(homedir(), '.claude-mem');
// After:
const DEFAULT_DATA_DIR = join(homedir(), '.engram');
```

- [ ] **Step 7: Replace in ProcessManager.ts**

In `src/services/infrastructure/ProcessManager.ts` line 24:
```typescript
// Before:
const DATA_DIR = path.join(homedir(), '.claude-mem');
// After:
const DATA_DIR = path.join(homedir(), '.engram');
```

- [ ] **Step 8: Replace in supervisor/shutdown.ts**

In `src/supervisor/shutdown.ts` line 11:
```typescript
// Before:
const DATA_DIR = path.join(homedir(), '.claude-mem');
// After:
const DATA_DIR = path.join(homedir(), '.engram');
```

- [ ] **Step 9: Replace in supervisor/index.ts**

In `src/supervisor/index.ts` (line 9 or 24):
```typescript
// Before:
const DATA_DIR = path.join(homedir(), '.claude-mem');
// After:
const DATA_DIR = path.join(homedir(), '.engram');
```

- [ ] **Step 10: Replace in 6 additional files**

`src/shared/paths.ts` line 54 (cache path) and line 59 (data dir):
```typescript
// line 54 — cache lookup path for plugin fallback
return join(pluginsDirectory(), 'cache', 'thedotmack', 'engram', version);
// line 59 — data dir
return join(homedir(), '.engram');
```

`src/npx-cli/utils/paths.ts` line 59:
```typescript
return join(homedir(), '.engram');
```

`src/utils/claude-md-utils.ts` line 21:
```typescript
const SETTINGS_PATH = path.join(os.homedir(), '.engram', 'settings.json');
```

`src/services/context/ContextConfigLoader.ts` line 18:
```typescript
const settingsPath = path.join(homedir(), '.engram', 'settings.json');
```

`src/services/sync/ChromaMcpManager.ts` lines 31 and 370:
```typescript
// line 31
const DEFAULT_CHROMA_DATA_DIR = path.join(os.homedir(), '.engram', 'chroma');
// line 370
const combinedCertPath = path.join(os.homedir(), '.engram', 'combined_certs.pem');
```

`src/services/integrations/CodexCliInstaller.ts` line 35:
```typescript
const CLAUDE_MEM_DIR = path.join(homedir(), '.engram');
```

- [ ] **Step 11: Verify no .claude-mem directory-path references remain**

```bash
grep -rn "homedir.*claude-mem\|\.claude-mem'" src/ --include="*.ts"
```
Expected: zero matches

- [ ] **Step 11: TypeScript compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 12: Commit**

```bash
git add src/shared/EnvManager.ts src/shared/SettingsDefaultsManager.ts \
  src/services/transcripts/config.ts src/cli/claude-md-commands.ts \
  src/utils/logger.ts src/services/infrastructure/ProcessManager.ts \
  src/supervisor/shutdown.ts src/supervisor/index.ts
git commit -m "fix: rename data directory from .claude-mem to .engram across all source files"
```

---

## Task 4: Fix settings boolean normalization + server.ts output

Two related fixes: the settings loader should coerce `true`/`false` booleans to strings, and the server CLI command should output `"true"` (string) not `true` (boolean) in the example config it shows users.

**Files:**
- Modify: `src/shared/SettingsDefaultsManager.ts` (~line 269)
- Modify: `src/npx-cli/commands/server.ts` (line 35)

- [ ] **Step 1: Add boolean normalization in SettingsDefaultsManager.ts**

In `src/shared/SettingsDefaultsManager.ts`, find the merge loop inside `loadFromFile()` that looks like:
```typescript
for (const key of Object.keys(this.DEFAULTS) as Array<keyof SettingsDefaults>) {
  if (flatSettings[key] !== undefined) {
    result[key] = flatSettings[key];
  }
}
```

Change the assignment to:
```typescript
for (const key of Object.keys(this.DEFAULTS) as Array<keyof SettingsDefaults>) {
  if (flatSettings[key] !== undefined) {
    const raw = flatSettings[key];
    result[key] = (raw === true) ? 'true' : (raw === false) ? 'false' : raw;
  }
}
```

- [ ] **Step 2: Fix server.ts boolean output**

In `src/npx-cli/commands/server.ts` line 35, change:
```typescript
CLAUDE_MEM_SYNC_ENABLED: true,
```
to:
```typescript
CLAUDE_MEM_SYNC_ENABLED: "true",
```

- [ ] **Step 3: TypeScript compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/shared/SettingsDefaultsManager.ts src/npx-cli/commands/server.ts
git commit -m "fix: normalize boolean settings to strings; fix server.ts sync enabled output"
```

---

## Task 5: Add force-restart command to worker-service.ts

The current `restart` command tries a graceful HTTP shutdown then respawns — but if the worker is healthy and the port check passes, the flow still works. The problem is `npm run worker:restart` calls `restart` which goes through `httpShutdown` — this works but only if the worker is reachable. A `force-restart` kills by PID directly, which works even if the HTTP endpoint is unresponsive.

**Files:**
- Modify: `src/services/worker-service.ts`
- Modify: `package.json` (add script)

- [ ] **Step 1: Add force-restart case to the switch statement**

In `src/services/worker-service.ts`, in the `switch (command)` block, add after the existing `restart` case (around line 1165):

```typescript
case 'force-restart': {
  logger.info('SYSTEM', 'Force-restarting worker (kill by PID)');
  // Try to kill by PID first
  const pidInfo = readPidFile();
  if (pidInfo?.pid) {
    try {
      process.kill(pidInfo.pid, 'SIGTERM');
      logger.info('SYSTEM', 'Sent SIGTERM to worker', { pid: pidInfo.pid });
      // Wait up to 2s for process to exit
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        try {
          process.kill(pidInfo.pid, 0); // probe: throws if process is gone
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch {
          break; // process is gone
        }
      }
    } catch (err) {
      logger.info('SYSTEM', 'Worker process not found (already stopped)', { pid: pidInfo.pid });
    }
  }
  // Wait for port to free BEFORE removing PID file (mirrors existing restart case)
  const forceRestartFreed = await waitForPortFree(port, getPlatformTimeout(15000));
  if (!forceRestartFreed) {
    logger.error('SYSTEM', 'Port did not free up after kill, aborting force-restart', { port });
    process.exit(0);
  }
  removePidFile();

  const pid = spawnDaemon(__filename, port);
  if (pid === undefined) {
    logger.error('SYSTEM', 'Failed to spawn worker daemon during force-restart');
    process.exit(0);
  }

  const healthy = await waitForHealth(port, getPlatformTimeout(HOOK_TIMEOUTS.POST_SPAWN_WAIT));
  if (!healthy) {
    removePidFile();
    logger.error('SYSTEM', 'Worker did not become healthy after force-restart');
    process.exit(0);
  }
  logger.info('SYSTEM', 'Worker force-restarted successfully', { pid });
  process.exit(0);
  break;
}
```

Note: `readPidFile` must be imported from ProcessManager. Check the existing imports at the top of the file — if `readPidFile` is not already imported, add it to the import from `'./infrastructure/ProcessManager.js'`.

- [ ] **Step 2: Verify readPidFile is imported**

```bash
grep "readPidFile\|from.*ProcessManager" src/services/worker-service.ts | head -5
```

If `readPidFile` is not in the import, add it:
```typescript
import {
  // ... existing imports ...
  readPidFile,
} from './infrastructure/ProcessManager.js';
```

- [ ] **Step 3: Add force-restart to hookInitiatedCommands list**

Find the line:
```typescript
const hookInitiatedCommands = ['start', 'hook', 'restart', '--daemon'];
```
Change to:
```typescript
const hookInitiatedCommands = ['start', 'hook', 'restart', 'force-restart', '--daemon'];
```

- [ ] **Step 4: Add npm script in package.json**

In `package.json` scripts, add:
```json
"worker:force-restart": "bun plugin/scripts/worker-service.cjs force-restart"
```

- [ ] **Step 5: TypeScript compile check**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/services/worker-service.ts package.json
git commit -m "feat: add force-restart command to worker-service for reliable settings reload"
```

---

## Task 6: Create setup.sh wizard

The Setup hook already references `"$_R/scripts/setup.sh"` in `plugin/hooks/hooks.json` — this file doesn't exist yet. Create it as a first-run wizard that configures sync credentials.

**Files:**
- Create: `plugin/scripts/setup.sh`

- [ ] **Step 1: Create the wizard script**

Create `plugin/scripts/setup.sh` with the following content:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Engram first-run setup wizard
# Called by Claude Code's Setup hook on plugin install/update.
# Idempotent: exits silently if sync is already configured.

ENGRAM_DIR="$HOME/.engram"
SETTINGS_FILE="$ENGRAM_DIR/settings.json"

# Guard: exit silently if no TTY (headless/CI install)
[ -t 0 ] || exit 0

# Guard: exit silently if already configured
if [ -f "$SETTINGS_FILE" ]; then
  api_key=$(node -e "
    try {
      const s = JSON.parse(require('fs').readFileSync('$SETTINGS_FILE', 'utf8'));
      process.stdout.write(s.CLAUDE_MEM_SYNC_API_KEY || '');
    } catch { process.stdout.write(''); }
  " 2>/dev/null || echo "")
  if [ -n "$api_key" ]; then
    exit 0
  fi
fi

# ── Migration check ────────────────────────────────────────────────────────────
if [ ! -d "$ENGRAM_DIR" ] && [ -d "$HOME/.claude-mem" ]; then
  echo ""
  echo "Engram detected existing claude-mem data at ~/.claude-mem"
  printf "Migrate your existing memory data to ~/.engram? [Y/n]: "
  read -r migrate_answer
  migrate_answer="${migrate_answer:-Y}"
  if [[ "$migrate_answer" =~ ^[Yy]$ ]]; then
    cp -r "$HOME/.claude-mem" "$ENGRAM_DIR"
    # Patch CLAUDE_MEM_DATA_DIR in the copied settings to point to ~/.engram
    node -e "
      const f = '$SETTINGS_FILE';
      try {
        const d = JSON.parse(require('fs').readFileSync(f, 'utf8'));
        d.CLAUDE_MEM_DATA_DIR = '$ENGRAM_DIR';
        require('fs').writeFileSync(f, JSON.stringify(d, null, 2));
      } catch {}
    " 2>/dev/null || true
    echo "✓ Data migrated to ~/.engram"
  else
    mkdir -p "$ENGRAM_DIR"
  fi
else
  mkdir -p "$ENGRAM_DIR"
fi

# ── Welcome ────────────────────────────────────────────────────────────────────
echo ""
echo "╔════════════════════════════════════════╗"
echo "║         Welcome to Engram              ║"
echo "║   Multi-agent memory for Claude Code   ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo "Let's configure your sync connection."
echo "(Contact Thiago to get your API key)"
echo ""

# ── Prompt for API key ─────────────────────────────────────────────────────────
printf "Enter your API key: "
read -r api_key
if [ -z "$api_key" ]; then
  echo "No API key entered. Skipping sync configuration."
  echo "Run 'claude plugin setup' to configure later."
  exit 0
fi

# ── Prompt for agent name ──────────────────────────────────────────────────────
default_name=$(hostname -s 2>/dev/null || echo "my-machine")
printf "Enter agent name [default: %s]: " "$default_name"
read -r agent_name
agent_name="${agent_name:-$default_name}"

# ── Write settings ─────────────────────────────────────────────────────────────
node -e "
  const f = '$SETTINGS_FILE';
  let settings = {};
  try { settings = JSON.parse(require('fs').readFileSync(f, 'utf8')); } catch {}
  settings.CLAUDE_MEM_SYNC_ENABLED = 'true';
  settings.CLAUDE_MEM_SYNC_SERVER_URL = 'https://engram-ashy.vercel.app';
  settings.CLAUDE_MEM_SYNC_API_KEY = '$api_key';
  settings.CLAUDE_MEM_SYNC_AGENT_NAME = '$agent_name';
  require('fs').writeFileSync(f, JSON.stringify(settings, null, 2));
  console.log('');
  console.log('✓ Engram configured successfully!');
  console.log('  Agent: $agent_name');
  console.log('  Server: https://engram-ashy.vercel.app');
  console.log('');
  console.log('Observations will sync after each session.');
" 2>/dev/null

exit 0
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x plugin/scripts/setup.sh
```

- [ ] **Step 3: Test idempotency — run with no settings dir**

```bash
# Test in isolation with a temp dir
ENGRAM_DIR_BACKUP="$HOME/.engram"
mkdir -p /tmp/engram-test
# Run with simulated no-TTY (should exit silently)
echo "" | bash plugin/scripts/setup.sh 2>&1
echo "Exit code: $?"
```
Expected: exits 0 silently (no TTY → guard fires)

- [ ] **Step 4: Test that hooks.json wires it up correctly**

```bash
grep "setup.sh" plugin/hooks/hooks.json
```
Expected: one match in the Setup hook command

- [ ] **Step 5: Commit**

```bash
git add plugin/scripts/setup.sh
git commit -m "feat: add setup.sh wizard for first-run sync configuration"
```

> **Note on shell injection fix:** The setup.sh script above must pass `api_key` and `agent_name` to node via environment variables — NOT via shell string interpolation. Replace the final `node -e "..."` write block in setup.sh with:
>
> ```bash
> ENGRAM_API_KEY="$api_key" ENGRAM_AGENT_NAME="$agent_name" node -e "
>   const f = process.env.HOME + '/.engram/settings.json';
>   let settings = {};
>   try { settings = JSON.parse(require('fs').readFileSync(f, 'utf8')); } catch {}
>   settings.CLAUDE_MEM_SYNC_ENABLED = 'true';
>   settings.CLAUDE_MEM_SYNC_SERVER_URL = 'https://engram-ashy.vercel.app';
>   settings.CLAUDE_MEM_SYNC_API_KEY = process.env.ENGRAM_API_KEY;
>   settings.CLAUDE_MEM_SYNC_AGENT_NAME = process.env.ENGRAM_AGENT_NAME;
>   require('fs').writeFileSync(f, JSON.stringify(settings, null, 2));
>   console.log('');
>   console.log('✓ Engram configured successfully!');
>   console.log('  Agent:', process.env.ENGRAM_AGENT_NAME);
>   console.log('  Server: https://engram-ashy.vercel.app');
>   console.log('  Observations will sync after each session.');
> "
> ```
>
> Apply the same env-var approach to the migration patch block — pass `$ENGRAM_DIR` via `ENGRAM_DIR="$ENGRAM_DIR" node -e "...process.env.ENGRAM_DIR..."` instead of inline `'$ENGRAM_DIR'`.

---

## Task 7: Build and sync, update README

Rebuild the compiled plugin, sync to the installed marketplace copy, and update the README.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run build and sync**

```bash
npm run build-and-sync
```
Expected: build succeeds, sync completes, worker restart triggered

- [ ] **Step 2: Verify the compiled worker has .engram paths**

```bash
grep -c "\.engram" plugin/scripts/worker-service.cjs
```
Expected: non-zero (several matches)

```bash
grep "\.claude-mem" plugin/scripts/worker-service.cjs | grep -v "claude-mem\.db\|claude-mem-" | wc -l
```
Expected: 0 (no directory-path references to `.claude-mem`)

- [ ] **Step 3: Verify setup.sh is in the installed plugin**

```bash
ls ~/.claude/plugins/marketplaces/thedotmack/plugin/scripts/setup.sh
```
Expected: file exists

- [ ] **Step 4: Update README install section**

Find the install/setup section in `README.md` and replace it with:

```markdown
## Install

1. Install the plugin:

   ```bash
   claude plugin install https://github.com/<your-org>/engram
   ```

2. Claude Code runs the setup wizard automatically on install.
   When prompted:
   - Enter your API key (contact Thiago to get one)
   - Enter an agent name (e.g. `thiago-macbook` — identifies this machine in shared memory)

3. Done. Observations sync to the shared server after each session.

## Update

```bash
npm run build-and-sync
```

## Force-restart the worker

Use this after changing settings manually:

```bash
npm run worker:force-restart
```
```

- [ ] **Step 5: Commit**

```bash
git add README.md plugin/scripts/worker-service.cjs
git commit -m "docs: update README with clean install instructions for end users"
```

---

## Task 8: End-to-end smoke test

Verify the full install flow works from scratch.

- [ ] **Step 1: Verify hooks.json fallback paths are all updated**

```bash
grep "cache/thedotmack" plugin/hooks/hooks.json | grep "claude-mem"
```
Expected: zero matches

- [ ] **Step 2: Verify the bun-runner.js plugin key check**

```bash
grep "enabledPlugins" plugin/scripts/bun-runner.js
```
Expected: `engram@thedotmack` (not `claude-mem@thedotmack`)

- [ ] **Step 3: Simulate fresh install — test hook fires with correct CLAUDE_PLUGIN_ROOT**

```bash
_R="$HOME/.claude/plugins/marketplaces/thedotmack/plugin"
echo '{}' | CLAUDE_PLUGIN_ROOT="$_R" node "$_R/scripts/bun-runner.js" "$_R/scripts/worker-service.cjs" hook claude-code session-init
echo "Exit: $?"
```
Expected: outputs `{}` and exits 0

- [ ] **Step 4: Simulate fallback path (no CLAUDE_PLUGIN_ROOT set)**

```bash
_R=$(ls -dt "$HOME/.claude/plugins/cache/thedotmack/engram/"[0-9]*/ 2>/dev/null | head -1)
if [ -n "$_R" ]; then
  echo "Cache path found: $_R"
  echo '{}' | node "$_R/scripts/bun-runner.js" "$_R/scripts/worker-service.cjs" hook claude-code session-init
  echo "Exit: $?"
else
  echo "No engram cache entry yet (expected for fresh installs — OK)"
fi
```

- [ ] **Step 5: Verify sync queue gets entries after an observation**

```bash
sqlite3 ~/.engram/claude-mem.db "SELECT COUNT(*) FROM sync_queue WHERE status='pending';"
```
Start a new Claude Code session, let it generate an observation, then:
```bash
sqlite3 ~/.engram/claude-mem.db "SELECT entity_type, status FROM sync_queue ORDER BY id DESC LIMIT 3;"
```
Expected: rows with `observation|synced` or `observation|pending`

- [ ] **Step 6: Verify force-restart works**

```bash
npm run worker:force-restart
sleep 3
curl -s http://127.0.0.1:37777/api/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if d.get('status')=='ok' else 'fail')" 2>/dev/null || rtk proxy "curl -s http://127.0.0.1:37777/api/health" | grep '"status"'
```
Expected: `ok` (new PID, low uptime)

- [ ] **Step 7: Commit any final fixes found during smoke test**

```bash
git add -p
git commit -m "fix: smoke test corrections"
```
(Only if changes were needed)
