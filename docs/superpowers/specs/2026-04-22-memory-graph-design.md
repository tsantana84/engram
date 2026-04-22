# Memory Graph — Design Spec

**Date:** 2026-04-22
**Scope:** P2 roadmap item — build a relationship graph linking observations to files, concepts, and other observations
**Goal:** Answer "show everything connected to X" via graph traversal that complements Chroma semantic search

---

## Context

Engram's current retrieval is two-dimensional: SQLite FTS5 (keyword) and Chroma (semantic similarity). Both find *similar* content but cannot capture *relationships between things*. The Memory Graph adds a third dimension: explicit edges between entities. "What touched `SupabaseManager.ts`?", "What observations share the `sync` concept?", "What contradicts this learning?"

---

## Surfaces

Two surfaces:
1. **MCP tool** — `graph(query, depth)` Claude calls during sessions
2. **Local UI** — brutalist list view at `http://localhost:37777/graph`

---

## Section 1 — Data Model

### `graph_edges` table (new SQLite migration)

```sql
CREATE TABLE graph_edges (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  from_type        TEXT NOT NULL,  -- 'observation' | 'file' | 'concept' | 'session'
  from_id          TEXT NOT NULL,  -- obs id (int as string), file path, concept name, session id
  to_type          TEXT NOT NULL,
  to_id            TEXT NOT NULL,
  relationship     TEXT NOT NULL,  -- rule: 'co-file' | 'co-concept' | 'co-session'
                                   -- llm:  'contradicts' | 'depends-on' | 'supersedes' | 'confirms'
  weight           REAL DEFAULT 1.0,
  source           TEXT NOT NULL,  -- 'rule' | 'llm'
  created_at_epoch INTEGER NOT NULL
);

CREATE INDEX idx_graph_from ON graph_edges(from_type, from_id);
CREATE INDEX idx_graph_to   ON graph_edges(to_type, to_id);
```

### Node model

No separate nodes table. Nodes are existing entities resolved by type:
- `observation` → `observations` table by integer id
- `file` → path string (no table; file may not exist on disk)
- `concept` → concept name string (no table)
- `session` → identified by `memory_session_id` UUID string (the column name on both `observations` and `sdk_sessions`). Always use the UUID, never the integer PK, for session node IDs.

### Edge directionality

Edges are undirected but stored bidirectionally. When A→B is written, B→A is also written in the same transaction. Traversal queries only follow `from_type + from_id`, no UNION needed.

---

## Section 2 — Edge Creation

### Rule-based edges (always on)

Written in two passes to avoid transaction visibility issues:

**Pass 1 — inside the existing transaction** in `src/services/sqlite/transactions.ts` (`storeObservationsAndMarkComplete`), alongside the observation insert:

1. `observation → file` (relationship: `co-file`) for each path in `files_read` + `files_modified`
2. `observation → concept` (relationship: `co-concept`) for each entry in `concepts` JSON array
3. `observation → session` (relationship: `co-session`) via `memory_session_id`

**Pass 2 — after the transaction commits**, in `src/services/worker/agents/ResponseProcessor.ts`, immediately after the `storeObservations()` call returns (using the returned `observationIds`):

4. `observation → observation` (relationship: `co-file`) for any observation in the same project that already has an edge to the same file
5. `observation → observation` (relationship: `co-concept`) for any observation in the same project that already has an edge to the same concept

Pass 1 is atomic with the observation insert. Pass 2 runs after commit so it sees the newly written Pass 1 edges — this is what allows cross-links between observations stored in the same batch.

**`db` instance:** `GraphStore` must receive the same `db` reference used by `transactions.ts`. `SessionStore` exposes the raw `bun:sqlite` `Database` via a new method `getDb(): Database` added to `SessionStore`. `GraphStore` is constructed inside `SessionStore` with `this.db`. Do not create a separate connection.

**Performance:** Steps 4–5 query `graph_edges` with indexes on `to_type + to_id`. Bounded by project scope. Acceptable for a post-transaction synchronous write.

### LLM-based edges (when extraction enabled)

New class: `src/services/sync/GraphEdgeExtractor.ts`

Runs at session-end alongside `LearningExtractor`, triggered from `SyncWorker` when `CLAUDE_MEM_LEARNING_EXTRACTION_ENABLED=true`.

**Process:**
1. Load all observations from the completed session
2. Send to LLM with a structured prompt requesting relationship extraction
3. LLM returns array of `{ from_id, to_id, relationship }` — relationship is one of: `contradicts | depends-on | supersedes | confirms`
4. Write edges with `source: 'llm'` into `graph_edges`

**Prompt contract:** LLM receives observation titles + narratives (not full text). Returns JSON only. Same provider/model as `LearningExtractor` (`CLAUDE_MEM_LEARNING_LLM_PROVIDER`, `CLAUDE_MEM_LEARNING_LLM_MODEL`).

**If extraction disabled:** `GraphEdgeExtractor` is never instantiated. Rule-based edges still exist and the graph is fully functional.

---

## Section 3 — Traversal & API

### `GraphStore` class

New file: `src/services/sqlite/graph/GraphStore.ts`

```typescript
interface GraphResult {
  center: { type: string; id: string };
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface GraphNode {
  type: string;
  id: string;
  // observation nodes include: title, created_at
  // file nodes include: path
  // concept nodes include: name
}

interface GraphEdge {
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relationship: string;
  source: 'rule' | 'llm';
}

class GraphStore {
  traverse(entity: { type: string; id: string }, depth: number): GraphResult
  addEdge(from: Node, to: Node, relationship: string, source: string): void
  addEdgePair(from: Node, to: Node, relationship: string, source: string): void
  // addEdgePair has two modes:
  // - When called OUTSIDE a transaction (Pass 2, LLM edges): wraps both inserts
  //   in db.transaction() for atomicity.
  // - When called INSIDE an existing transaction (Pass 1): uses plain
  //   db.prepare(...).run() calls only — NO db.transaction() wrapper.
  //   bun:sqlite does NOT auto-promote to SAVEPOINT; nested db.transaction()
  //   throws "cannot start a transaction within a transaction".
  //   The caller's outer transaction provides atomicity.
  // addEdgePair accepts an optional `inTransaction: boolean` flag to select mode.
}
```

**Traversal implementation:** SQLite recursive CTE (`WITH RECURSIVE`) starting from the center node, following `graph_edges` up to `depth` hops. Depth capped at 3.

Because edges are stored bidirectionally, naïve recursion revisits nodes (A→B→A→B…) and produces duplicates before the depth cap fires. The CTE must track visited nodes. Implementation approach: accumulate a `visited` text column (`from_type||':'||from_id`) and use `instr(visited, to_type||':'||to_id) = 0` to skip already-visited nodes. This works correctly for depth ≤ 3. A `TEMP TABLE` of visited keys is an acceptable alternative for larger graphs.

### API endpoint

New route in `src/services/worker/http/routes/GraphRoutes.ts`:

```
GET /api/graph
  ?entity=<id or name>   required
  ?type=<node type>      required: 'file' | 'concept' | 'observation' | 'session'
  ?depth=<1-3>           optional, default 2
  ?project=<name>        optional, filter to project
```

Response:
```json
{
  "center": { "type": "file", "id": "api/lib/SupabaseManager.ts" },
  "nodes": [
    { "type": "observation", "id": "1234", "title": "Fixed touchAgentSync", "created_at": "2026-04-21T..." },
    { "type": "concept", "id": "authentication" },
    { "type": "file", "id": "api/sync/push.ts" }
  ],
  "edges": [
    {
      "from_type": "observation", "from_id": "1234",
      "to_type": "file", "to_id": "api/lib/SupabaseManager.ts",
      "relationship": "co-file", "source": "rule"
    }
  ]
}
```

Returns HTTP 400 if `entity` or `type` missing. Returns empty nodes/edges (not 404) if entity has no edges yet.

---

## Section 4 — MCP Tool

Added directly to `src/servers/mcp-server.ts` — the tools array in that file, not a separate directory. The compiled output is `plugin/scripts/mcp-server.cjs` via `npm run build-and-sync`.

**Wiring:** append an entry to the `tools` array in `mcp-server.ts` with `name`, `description`, `inputSchema`, and a `handler` that calls `callWorkerAPI('/api/graph', args)`. Add `'graph': '/api/graph'` to `TOOL_ENDPOINT_MAP`.

**Tool definition:**
```
graph(query: string, depth?: number)
```

**Entity type detection from `query`:**
- Contains `/` or ends with known extension (`.ts`, `.js`, `.py`, `.md`, etc.) → `file`
- Purely numeric → `observation`
- Otherwise → `concept`

**Formatted output (token-efficient):**
```
Graph: api/lib/SupabaseManager.ts (depth 2, 14 nodes)

Observations (8):
  #1234 "Fixed touchAgentSync missing error handling" [2026-04-21]
  #890  "RLS policy blocked sync" [2026-04-21]
  ...

Concepts (3): authentication · supabase · sync

Files (4): api/sync/push.ts · api/sync/learnings.ts · api/agents/index.ts · ...

LLM edges:
  #1234 contradicts #890
  #2201 depends-on #1234

Use get_observations([1234, 890, 2201]) for full details.
```

Returns IDs + titles only. Full content retrieved via `get_observations` as needed.

---

## Section 5 — Local UI

Static HTML page at `plugin/ui/graph.html`, served by `ViewerRoutes.ts` at `GET /graph`.

**Design:** Same brutalist system as sessions/ticks/admin (black/yellow/red, Courier New, 3px solid borders). ES5-compatible JavaScript only (no `let`/`const`/arrow functions/template literals).

**Layout:**

```
┌─────────────────────────────────────────────────┐
│ ⬡ ENGRAM WORKER  [Sessions] [Admin] [Ticks] [Graph] │
├─────────────────────────────────────────────────┤
│ MEMORY GRAPH                                     │
│ [________________] [file ▾] [depth: 2 ▾] [SEARCH] │
├─────────────────────────────────────────────────┤
│ CENTER: api/lib/SupabaseManager.ts               │
│ 14 connected nodes                               │
├──────────────┬──────────────┬───────────────────┤
│ OBSERVATIONS │ CONCEPTS     │ FILES             │
│ ─────────── │ ─────────── │ ───────────────── │
│ #1234        │ authentication│ api/sync/push.ts  │
│ Fixed touch  │ supabase     │ api/sync/learn... │
│ AgentSync... │ sync         │ ...               │
│ [click→obs] │              │                   │
├──────────────┴──────────────┴───────────────────┤
│ LLM EDGES (2)                                    │
│ #1234 contradicts #890                           │
│ #2201 depends-on #1234                           │
└─────────────────────────────────────────────────┘
```

**Behavior:**
- Search fires `GET /api/graph?entity=...&type=...&depth=...`
- Observation cards link to `/?id=<obs_id>` (sessions page filtered)
- "LLM EDGES" section hidden if no LLM edges in result
- Error state shown inline if entity not found or no edges

---

## Files Changed

| File | Action | Purpose |
|---|---|---|
| `src/services/sqlite/migrations/runner.ts` | Modify | Add `createGraphEdgesTable()` called from `runAllMigrations()` |
| `src/services/sqlite/SessionStore.ts` | Modify | Add `getDb(): Database` to expose raw db reference |
| `src/services/sqlite/graph/GraphStore.ts` | Create | Traversal logic, edge writes, `addEdgePair` |
| `src/services/sqlite/transactions.ts` | Modify | Pass 1 rule-based edges inside existing transaction |
| `src/services/worker/agents/ResponseProcessor.ts` | Modify | Pass 2 cross-link edges after `storeObservations()` returns |
| `src/services/sync/GraphEdgeExtractor.ts` | Create | LLM semantic edge extraction at session-end |
| `src/services/sync/SyncWorker.ts` | Modify | Trigger `GraphEdgeExtractor` at session-end |
| `src/services/worker/http/routes/GraphRoutes.ts` | Create | `GET /api/graph` endpoint |
| `src/services/worker-service.ts` | Modify | Register GraphRoutes (not WorkerServer.ts) |
| `src/servers/mcp-server.ts` | Modify | Add `graph` tool entry to tools array + TOOL_ENDPOINT_MAP |
| `plugin/ui/graph.html` | Create | Brutalist graph UI |

---

## Success Criteria

1. `GET /api/graph?entity=SupabaseManager.ts&type=file` returns all observations that read or modified that file
2. Rule-based edges are written automatically when observations are stored — no manual step
3. LLM edges appear when extraction is enabled; absent when disabled
4. MCP `graph` tool returns formatted result Claude can act on within 2 seconds
5. Graph UI at `localhost:37777/graph` renders results without page reload
6. Depth-3 traversal on a graph with 1000+ edges completes in under 500ms
