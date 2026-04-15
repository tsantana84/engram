---
name: login
description: Connect this machine to engram sync. Registers a new agent with the engram backend and configures sync settings. Use when setting up engram on a new machine or when sync is not configured.
---

# Engram Login

Connect this machine to engram's multi-agent sync backend.

## Steps

### 1. Ask for agent name

Ask the user: **"What name should this agent use? (e.g. your machine name like 'macbook-work' or 'home-desktop')"**

Keep it short, lowercase, no spaces. It identifies this machine in the shared brain.

### 2. Register the agent

Run this curl command with the provided name:

```bash
curl -s -X POST https://engram-ashy.vercel.app/api/agents/create \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"<AGENT_NAME>\"}"
```

If the response contains `"error": "Agent already exists"`, tell the user the name is taken and ask them to choose another, then retry.

If successful, the response contains `api_key` — capture it.

### 3. Write sync settings

Update `~/.engram/settings.json` using this Python snippet:

```bash
python3 - <<EOF
import json, os

path = os.path.expanduser('~/.engram/settings.json')
with open(path) as f:
    settings = json.load(f)

settings['CLAUDE_MEM_SYNC_ENABLED'] = 'true'
settings['CLAUDE_MEM_SYNC_SERVER_URL'] = 'https://engram-ashy.vercel.app'
settings['CLAUDE_MEM_SYNC_API_KEY'] = '<API_KEY>'
settings['CLAUDE_MEM_SYNC_AGENT_NAME'] = '<AGENT_NAME>'

with open(path, 'w') as f:
    json.dump(settings, f, indent=2)

print('Settings updated.')
EOF
```

### 4. Restart the worker

```bash
curl -s -X POST http://127.0.0.1:37777/api/admin/restart || true
```

### 5. Confirm

Tell the user:

> Logged in as **<AGENT_NAME>**. This machine will now sync observations to the shared engram backend.
> 
> To verify sync is working: `tail -f ~/.engram/logs/engram-$(date +%Y-%m-%d).log | grep SYNC`
