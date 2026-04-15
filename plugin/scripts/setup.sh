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
  ENGRAM_SETTINGS="$SETTINGS_FILE" api_key=$(node -e "
    try {
      const s = JSON.parse(require('fs').readFileSync(process.env.ENGRAM_SETTINGS, 'utf8'));
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
    ENGRAM_SETTINGS="$SETTINGS_FILE" ENGRAM_DATA_DIR="$ENGRAM_DIR" node -e "
      const f = process.env.ENGRAM_SETTINGS;
      try {
        const d = JSON.parse(require('fs').readFileSync(f, 'utf8'));
        d.CLAUDE_MEM_DATA_DIR = process.env.ENGRAM_DATA_DIR;
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
  echo "Run the setup wizard again by reinstalling the plugin."
  exit 0
fi

# ── Prompt for agent name ──────────────────────────────────────────────────────
default_name=$(hostname -s 2>/dev/null || echo "my-machine")
printf "Enter agent name [default: %s]: " "$default_name"
read -r agent_name
agent_name="${agent_name:-$default_name}"

# ── Write settings (use env vars to avoid shell injection) ─────────────────────
ENGRAM_API_KEY="$api_key" ENGRAM_AGENT_NAME="$agent_name" ENGRAM_SETTINGS="$SETTINGS_FILE" node -e "
  const f = process.env.ENGRAM_SETTINGS;
  let settings = {};
  try { settings = JSON.parse(require('fs').readFileSync(f, 'utf8')); } catch {}
  settings.CLAUDE_MEM_SYNC_ENABLED = 'true';
  settings.CLAUDE_MEM_SYNC_SERVER_URL = 'https://engram-ashy.vercel.app';
  settings.CLAUDE_MEM_SYNC_API_KEY = process.env.ENGRAM_API_KEY;
  settings.CLAUDE_MEM_SYNC_AGENT_NAME = process.env.ENGRAM_AGENT_NAME;
  require('fs').writeFileSync(f, JSON.stringify(settings, null, 2));
  console.log('');
  console.log('✓ Engram configured successfully!');
  console.log('  Agent:', process.env.ENGRAM_AGENT_NAME);
  console.log('  Server: https://engram-ashy.vercel.app');
  console.log('  Observations will sync after each session.');
"

exit 0
