#!/bin/bash
set -euo pipefail

# engram installer
# Usage: curl -fsSL https://raw.githubusercontent.com/tsantana84/engram/main/install/public/install.sh | bash

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

REPO="tsantana84/engram"
MARKETPLACE_NAME="thedotmack"
PLUGIN_NAME="engram"
PLUGIN_KEY="${PLUGIN_NAME}@${MARKETPLACE_NAME}"
CLAUDE_PLUGINS_DIR="$HOME/.claude/plugins"
MARKETPLACE_DIR="$CLAUDE_PLUGINS_DIR/marketplaces/$MARKETPLACE_NAME"
PLUGIN_DIR="$MARKETPLACE_DIR/plugin"

echo ""
echo -e "${BOLD}${CYAN}engram installer${NC}"
echo ""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

info()    { echo -e "  ${CYAN}→${NC} $1"; }
success() { echo -e "  ${GREEN}✔${NC} $1"; }
warn()    { echo -e "  ${YELLOW}!${NC} $1"; }
fail()    { echo -e "  ${RED}✘${NC} $1"; exit 1; }

json_merge_key() {
  # json_merge_key <file> <key> <json_value>
  # Merges a top-level key into a JSON file, creating the file if needed.
  local file="$1" key="$2" value="$3"
  mkdir -p "$(dirname "$file")"
  if [ ! -f "$file" ]; then
    echo '{}' > "$file"
  fi
  local tmp
  tmp=$(mktemp)
  python3 - "$file" "$key" "$value" > "$tmp" <<'PYEOF'
import sys, json
file, key, value = sys.argv[1], sys.argv[2], sys.argv[3]
with open(file) as f:
    data = json.load(f)
data[key] = json.loads(value)
print(json.dumps(data, indent=2))
PYEOF
  mv "$tmp" "$file"
}

# ---------------------------------------------------------------------------
# 1. Check Node.js
# ---------------------------------------------------------------------------

info "Checking Node.js..."
if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install it from https://nodejs.org (v18+) and retry."
fi
NODE_VERSION=$(node -e "process.stdout.write(process.versions.node)")
info "Node.js $NODE_VERSION found"

# ---------------------------------------------------------------------------
# 2. Install Bun if missing
# ---------------------------------------------------------------------------

info "Checking Bun..."
if ! command -v bun &>/dev/null; then
  warn "Bun not found — installing..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  if ! command -v bun &>/dev/null; then
    fail "Bun install failed. Install manually from https://bun.sh and retry."
  fi
  success "Bun installed"
else
  BUN_VERSION=$(bun --version)
  info "Bun $BUN_VERSION found"
fi

# ---------------------------------------------------------------------------
# 3. Clone repo to temp dir
# ---------------------------------------------------------------------------

info "Downloading engram..."
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

git clone --depth 1 "https://github.com/$REPO.git" "$TMP_DIR/engram" --quiet
success "Downloaded engram"

# ---------------------------------------------------------------------------
# 4. Copy plugin files to marketplace directory
# ---------------------------------------------------------------------------

info "Installing plugin files..."
mkdir -p "$MARKETPLACE_DIR"
rsync -a --delete \
  --exclude=.git \
  --exclude=src \
  --exclude=docs \
  --exclude=node_modules \
  --exclude="*.lock" \
  "$TMP_DIR/engram/" "$MARKETPLACE_DIR/"

# Run bun install in marketplace dir
(cd "$MARKETPLACE_DIR" && bun install --silent)
success "Plugin files installed"

# ---------------------------------------------------------------------------
# 5. Register marketplace in known_marketplaces.json
# ---------------------------------------------------------------------------

info "Registering marketplace..."
KNOWN_MARKETPLACES="$CLAUDE_PLUGINS_DIR/known_marketplaces.json"
json_merge_key "$KNOWN_MARKETPLACES" "$MARKETPLACE_NAME" \
  "{\"source\":{\"source\":\"github\",\"repo\":\"$REPO\"},\"installLocation\":\"$MARKETPLACE_DIR\",\"lastUpdated\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
success "Marketplace registered"

# ---------------------------------------------------------------------------
# 6. Register plugin in installed_plugins.json
# ---------------------------------------------------------------------------

info "Registering plugin..."
INSTALLED_PLUGINS="$CLAUDE_PLUGINS_DIR/installed_plugins.json"
VERSION=$(node -e "const p=require('$PLUGIN_DIR/.claude-plugin/plugin.json');process.stdout.write(p.version)" 2>/dev/null || echo "12.1.0")
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

python3 - "$INSTALLED_PLUGINS" "$PLUGIN_KEY" "$PLUGIN_DIR" "$VERSION" "$NOW" <<'PYEOF'
import sys, json
file, key, install_path, version, now = sys.argv[1:]
try:
    with open(file) as f:
        data = json.load(f)
except:
    data = {}
if 'version' not in data: data['version'] = 2
if 'plugins' not in data: data['plugins'] = {}
data['plugins'][key] = [{"scope":"user","installPath":install_path,"version":version,"installedAt":now,"lastUpdated":now}]
with open(file, 'w') as f:
    json.dump(data, f, indent=2)
PYEOF
success "Plugin registered"

# ---------------------------------------------------------------------------
# 7. Enable plugin in Claude settings
# ---------------------------------------------------------------------------

info "Enabling plugin..."
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
json_merge_key "$CLAUDE_SETTINGS" "enabledPlugins" "{\"$PLUGIN_KEY\":true}" 2>/dev/null || true

# Safer: merge enabledPlugins without overwriting other keys
python3 - "$CLAUDE_SETTINGS" "$PLUGIN_KEY" <<'PYEOF'
import sys, json
file, key = sys.argv[1], sys.argv[2]
try:
    with open(file) as f:
        data = json.load(f)
except:
    data = {}
if 'enabledPlugins' not in data: data['enabledPlugins'] = {}
data['enabledPlugins'][key] = True
with open(file, 'w') as f:
    json.dump(data, f, indent=2)
PYEOF
success "Plugin enabled"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

echo ""
echo -e "  ${BOLD}${GREEN}engram installed successfully!${NC}"
echo ""
echo -e "  Plugin:  ${CYAN}$PLUGIN_KEY${NC}"
echo -e "  Version: ${CYAN}$VERSION${NC}"
echo -e "  Path:    ${CYAN}$PLUGIN_DIR${NC}"
echo ""
echo -e "  ${YELLOW}Restart Claude Code to activate.${NC}"
echo ""
