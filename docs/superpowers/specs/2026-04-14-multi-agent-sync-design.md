# Multi-Agent Sync: Shared Team Brain

**Date**: 2026-04-14
**Status**: Approved
**Author**: Thiago Santana + Claude

## Overview

Add multi-agent support to engram (claude-mem) so a team shares a persistent memory brain. Each team member runs engram locally as today. A central server collects and serves observations from all agents, giving everyone access to the team's collective knowledge.

**Approach**: Sync Layer (local-first). Local SQLite stays the source of truth for each agent. Observations push asynchronously to a central Postgres-backed server. Search queries merge local and team results into a single attributed timeline.

## 1. Identity & Authentication

Each team member registers as an agent via the server CLI:

```bash
engram server create-agent --name "Thiago"
# Output: API key cmem_ak_xxxxxxxxxxxx (shown once)
```

Local configuration in `~/.claude-mem/settings.json`:

```json
{
  "CLAUDE_MEM_SYNC_ENABLED": true,
  "CLAUDE_MEM_SYNC_SERVER_URL": "https://engram.your-team.com",
  "CLAUDE_MEM_SYNC_API_KEY": "cmem_ak_xxxxxxxxxxxx",
  "CLAUDE_MEM_SYNC_AGENT_NAME": "Thiago"
}
```

**Server-side `agents` table:**

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Internal ID |
| `name` | VARCHAR | Display name |
| `api_key_hash` | VARCHAR | bcrypt hash of the API key |
| `created_at` | TIMESTAMP | Registration time |
| `status` | VARCHAR | active / revoked |

Agent names must be **unique** (enforced by UNIQUE constraint on `name`). `create-agent` rejects duplicates. `revoke-agent --name` is unambiguous.

Authentication: `Authorization: Bearer cmem_ak_xxx` header on every request. Server hashes and looks up the key. No OAuth, no sessions.

Key management: create and revoke via CLI. No self-service rotation in v1.

## 2. Central Server Architecture

### Process Mode

`engram server start` launches the central server. Same codebase as the local worker, new entry point. Express/HTTP with Postgres backend.

### Server Database (Postgres)

Mirrors local SQLite schema with `agent_id` attribution:

| Table | Additions vs local |
|-------|-------------------|
| `agents` | New table (see Section 1) |
| `observations` | + `agent_id` FK, + `content_hash` unique on `(agent_id, content_hash)` |
| `sessions` | + `agent_id` FK, + `local_session_id` |
| `session_summaries` | + `agent_id` FK |

### Server Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/sync/push` | POST | Receive batch of observations/sessions from local worker |
| `/api/sync/status` | GET | Last sync timestamp for an agent |
| `/api/search` | GET | Team-wide search across all agents |
| `/api/timeline` | GET | Merged timeline across all agents |
| `/api/agents` | GET | List team members |
| `/api/agents` | POST | Create agent (CLI) |
| `/api/agents/:id/revoke` | POST | Revoke an agent's key |

No UI on the server. Headless API only.

### Deployment

Docker image or direct binary:

```bash
engram server start --port 8888 --database-url postgres://...
```

Ships with `docker/docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: claude_mem
      POSTGRES_PASSWORD: changeme
    volumes:
      - pgdata:/var/lib/postgresql/data

  engram-server:
    build: .
    command: engram server start
    environment:
      DATABASE_URL: postgres://postgres:changeme@postgres:5432/claude_mem
    ports:
      - "8888:8888"
    depends_on:
      - postgres

volumes:
  pgdata:
```

## 3. Sync Mechanism

Push-based, async, idempotent.

### Flow

1. Local worker stores observation in SQLite (unchanged)
2. Inserts entry into `sync_queue` table
3. Background sync loop (every 30s) batches pending items into POST `/api/sync/push`
4. Server confirms receipt, local marks items as `synced`

### Local `sync_queue` Table (SQLite)

| Column | Type | Purpose |
|--------|------|---------|
| `id` | INTEGER PK | Autoincrement |
| `entity_type` | TEXT | 'observation' / 'session' / 'summary' |
| `entity_id` | INTEGER | Local row ID |
| `status` | TEXT | pending / synced / failed |
| `attempts` | INTEGER | Default 0 |
| `created_at` | TEXT | When queued |
| `synced_at` | TEXT | When server confirmed |

### Content Hash

`content_hash` is a SHA-256 hex digest of `JSON.stringify({ type, title, subtitle, facts, narrative, concepts, files_read, files_modified })` with arrays sorted alphabetically before hashing. This is already computed locally (migration 20). The same algorithm runs on the server for verification.

### Push Payload

All columns from the local `observations` table are included. Abbreviated example:

```json
{
  "observations": [
    {
      "local_id": 42,
      "content_hash": "a1b2c3...",
      "type": "discovery",
      "title": "...",
      "subtitle": "...",
      "facts": ["..."],
      "narrative": "...",
      "concepts": ["..."],
      "files_read": ["..."],
      "files_modified": ["..."],
      "project": "engram",
      "created_at": "...",
      "created_at_epoch": 1713100000,
      "prompt_number": 5,
      "model_used": "claude-sonnet-4-20250514"
    }
  ],
  "sessions": [],
  "summaries": []
}
```

### Idempotency

Server uses `(agent_id, content_hash)` as unique constraint. Duplicate pushes silently ignored via `INSERT ... ON CONFLICT DO NOTHING`.

### Batch Size

Maximum 100 observations per push request. If the queue has more, the sync loop chunks into multiple sequential requests. This prevents oversized payloads from a long-offline agent.

### Failure Handling

- Network failure: item stays `pending`, retried next cycle
- 5 failed attempts: marked `failed`, logged, skipped
- Server 4xx: marked `failed` immediately, no retry
- Manual retry: `engram sync retry`

### Privacy

`<private>` tag stripping happens at the hook layer before the local worker sees data. Private content never reaches the sync queue or the server.

### Offline

Queue grows while disconnected. Drains when connectivity returns. Local experience unaffected.

## 4. Search & Retrieval

Local-first, server-augmented.

### Server Search Implementation

The central server uses **Postgres full-text search** via `tsvector`/`tsquery`:

- `observations` table gets a `search_vector TSVECTOR` column, auto-updated via trigger on `title`, `narrative`, and `array_to_string(facts, ' ') || ' ' || array_to_string(concepts, ' ')` (arrays concatenated to text before indexing)
- GIN index on `search_vector` for fast lookups
- Query parsing: user's search string passed through `plainto_tsquery('english', ...)` for natural language queries
- Ranking: `ts_rank_cd(search_vector, query)` combined with recency bias (`created_at` weight)
- Filtering: same parameters as local (`project`, `type`, `concepts`, `agent`) translated to WHERE clauses
- Timeline endpoint: standard `ORDER BY created_at DESC` with date grouping, no FTS needed

This provides functional parity with local SQLite FTS5 search. Semantic/vector search (Chroma equivalent) is deferred to v3.

### Query Flow

1. Query local SQLite (fast, zero-latency)
2. If sync enabled, proxy same query to central server
3. Merge results by `created_at`, deduplicate by `content_hash` — local copy wins over any remote copy; among remote duplicates, keep the earliest
4. Attribute: each observation gets `agent_name` and `source` fields

### Response Format

```json
{
  "observations": [
    {
      "id": 42,
      "agent_name": "Thiago",
      "source": "local",
      "type": "discovery",
      "title": "..."
    },
    {
      "id": 891,
      "agent_name": "Sarah",
      "source": "team",
      "type": "bugfix",
      "title": "..."
    }
  ]
}
```

### MCP Tools

Existing `search`, `smart_search`, `timeline`, `get_observations` tools automatically include team results when sync is enabled. No new parameters required. One new optional filter: `agent` (filter by team member name).

### Timeout

Server query has a 3-second timeout. If the server is slow or down, results return with local data only.

## 5. CLI Commands

### Server Management

```bash
engram server start --port 8888 --database-url postgres://...
engram server create-agent --name "Thiago"
engram server list-agents
engram server revoke-agent --name "Thiago"
```

### Client Sync

```bash
engram sync status      # sync state, last sync, pending count
engram sync retry       # retry all failed items
engram sync pause       # pause sync (queue still fills)
engram sync resume      # resume draining
```

### Configuration

| Setting | Default | Purpose |
|---------|---------|---------|
| `CLAUDE_MEM_SYNC_ENABLED` | `false` | Master toggle |
| `CLAUDE_MEM_SYNC_SERVER_URL` | `null` | Central server URL |
| `CLAUDE_MEM_SYNC_API_KEY` | `null` | Agent's API key |
| `CLAUDE_MEM_SYNC_AGENT_NAME` | `null` | Display name |
| `CLAUDE_MEM_SYNC_INTERVAL_MS` | `30000` | Batch push interval |
| `CLAUDE_MEM_SYNC_TIMEOUT_MS` | `3000` | Server query timeout |
| `CLAUDE_MEM_SYNC_MAX_RETRIES` | `5` | Before marking failed |

## 6. Database Changes Summary

### Local SQLite

- **New table**: `sync_queue` (see Section 3) — added via the existing SQLite migration runner as the next sequential migration
- **No changes** to existing tables
- Team observations are not cached locally; they appear only in search responses

### Central Postgres

- `agents` table with bcrypt-hashed API keys
- `observations`, `sessions`, `session_summaries` tables mirroring local schema + `agent_id` FK
- Unique constraint on `(agent_id, content_hash)` for idempotent sync
- Managed by migration runner adapted for Postgres

## 7. v1 Scope Boundaries

### In v1

- Agent registration and API key auth
- Central Postgres server with `engram server` process mode
- Async push-based sync with retry and failure handling
- Merged team search and timeline
- CLI for server and sync management
- Docker Compose for simple deployment
- `<private>` tag privacy (existing mechanism)

### NOT in v1

These are explicitly deferred to keep scope tight.

## 8. Future Versions

### v2: Team Intelligence

- **Team corpora**: Build and query Knowledge Agents from team-wide observations, not just local
- **RBAC / project-level permissions**: Control which agents can read which projects' observations
- **API key rotation**: Self-service key rotation without revoke/recreate cycle
- **Server UI / admin dashboard**: Web interface for managing agents, viewing sync health, browsing team observations
- **Rate limiting**: Required if the server is exposed beyond a trusted network

### v3: Advanced Collaboration

- **Pull / local cache**: Download and cache team observations locally for offline team search
- **Chroma sync**: Vector embeddings on the server for semantic team search (beyond Postgres full-text)
- **Audit log**: Track who searched what, when, for compliance and debugging
- **Conflict resolution policies**: Configurable strategies beyond "local wins" dedup
- **Observation reactions / annotations**: Team members can flag, comment on, or endorse each other's observations

### v4: Enterprise

- **SSO / OAuth integration**: GitHub org, Google Workspace, SAML for enterprise auth
- **Multi-team / org hierarchy**: Multiple teams within an organization, cross-team search policies
- **Observation retention policies**: Auto-archive or delete observations older than N days
- **Webhooks**: Notify external systems (Slack, etc.) when significant observations are shared
- **Horizontal scaling**: Multiple server instances behind a load balancer for large orgs
