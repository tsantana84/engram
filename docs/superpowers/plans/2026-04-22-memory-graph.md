# Memory Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a relationship graph linking observations to files, concepts, and other observations, queryable via MCP tool and brutalist local UI at `localhost:37777/graph`.

**Architecture:** SQLite adjacency list (`graph_edges` table) with bidirectional edges. Rule-based edges (co-file, co-concept, co-session) written automatically in two passes — Pass 1 inside the existing observation-store transaction, Pass 2 in ResponseProcessor.ts after commit. LLM edges (contradicts, depends-on, supersedes, confirms) written by `GraphEdgeExtractor` at session-end when extraction is enabled. Traversal uses SQLite recursive CTE with visited-node deduplication.

**Tech Stack:** bun:sqlite, TypeScript, Express, brutalist ES5 HTML/JS.

**Spec:** `docs/superpowers/specs/2026-04-22-memory-graph-design.md`

---

## Codebase Notes (read before implementing)

- Migration pattern: add a private method to `src/services/sqlite/migrations/runner.ts`, call it from the constructor. See `createSessionBriefingsTable()` (migration 32) as the pattern. Next migration is **33** — the tick_log table is not a numbered schema_versions migration.
- `SessionStore.db` is already `public` — no need to add `getDb()`. Use `sessionStore.db` directly.
- `storeObservationsAndMarkComplete` is in `src/services/sqlite/transactions.ts` and takes a raw `db: Database` parameter.
- Pass 1 edge writes must use `db.prepare(...).run(...)` directly inside the outer `db.transaction()` — do NOT call `db.transaction()` again (bun:sqlite throws on nested transactions).
- Pass 2 goes in `ResponseProcessor.ts` after `sessionStore.storeObservations()` returns.
- MCP tools are plain objects appended to the `tools` array in `src/servers/mcp-server.ts`. Add `'graph': '/api/graph'` to `TOOL_ENDPOINT_MAP`.
- Routes registered via `this.server.registerRoutes(new RouteClass(...))` in `src/services/worker-service.ts`.
- Static HTML pages served by `ViewerRoutes.ts` with fallback-path pattern.
- Test files go in `src/services/sqlite/__tests__/` (flat directory — no subdirectory per module).
- `bun test` runs the test suite.
- **XSS safety:** graph.html must use `textContent` and DOM methods only — never `innerHTML` with data values.

---

## Files

| File | Action |
|---|---|
| `src/services/sqlite/migrations/runner.ts` | Modify — add `createGraphEdgesTable()`, call from constructor |
| `src/services/sqlite/graph/GraphStore.ts` | Create — traversal, edge writes |
| `src/services/sqlite/__tests__/graph-store.test.ts` | Create — GraphStore unit tests |
| `src/services/sqlite/transactions.ts` | Modify — Pass 1 rule-based edges inside transaction |
| `src/services/worker/agents/ResponseProcessor.ts` | Modify — Pass 2 cross-link edges after storeObservations |
| `src/services/sync/GraphEdgeExtractor.ts` | Create — LLM semantic edge extraction |
| `src/services/sync/SyncWorker.ts` | Modify — trigger GraphEdgeExtractor at session-end |
| `src/services/worker/http/routes/GraphRoutes.ts` | Create — GET /api/graph endpoint |
| `src/services/worker-service.ts` | Modify — register GraphRoutes |
| `src/servers/mcp-server.ts` | Modify — add graph tool + TOOL_ENDPOINT_MAP entry |
| `src/services/worker/http/routes/ViewerRoutes.ts` | Modify — add GET /graph route |
| `plugin/ui/graph.html` | Create — brutalist graph UI (DOM-safe, no innerHTML with data) |

---

## Task 1: SQLite Migration — graph_edges table

**Files:**
- Modify: `src/services/sqlite/migrations/runner.ts`
- Create: `src/services/sqlite/__tests__/graph-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/sqlite/__tests__/graph-store.test.ts`:

```typescript
import { Database } from 'bun:sqlite';
import { describe, it, expect, beforeEach } from 'bun:test';
import { SessionStore } from '../../SessionStore';

describe('graph_edges migration', () => {
  let sessionStore: SessionStore;

  beforeEach(() => {
    sessionStore = new SessionStore(':memory:');
  });

  it('creates graph_edges table', () => {
    const result = sessionStore.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='graph_edges'")
      .get() as { name: string } | undefined;
    expect(result?.name).toBe('graph_edges');
  });

  it('creates idx_graph_from index', () => {
    const result = sessionStore.db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_graph_from'")
      .get() as { name: string } | undefined;
    expect(result?.name).toBe('idx_graph_from');
  });

  it('creates idx_graph_to index', () => {
    const result = sessionStore.db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_graph_to'")
      .get() as { name: string } | undefined;
    expect(result?.name).toBe('idx_graph_to');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/services/sqlite/__tests__/graph-store.test.ts
```

Expected: FAIL — "graph_edges" table not found.

- [ ] **Step 3: Add migration method to runner.ts**

In `src/services/sqlite/migrations/runner.ts`, add this private method:

```typescript
private createGraphEdgesTable(): void {
  const applied = this.db
    .prepare('SELECT version FROM schema_versions WHERE version = ?')
    .get(33) as SchemaVersion | undefined;
  if (applied) return;

  this.db.run(`
    CREATE TABLE IF NOT EXISTS graph_edges (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      from_type        TEXT NOT NULL,
      from_id          TEXT NOT NULL,
      to_type          TEXT NOT NULL,
      to_id            TEXT NOT NULL,
      relationship     TEXT NOT NULL,
      weight           REAL DEFAULT 1.0,
      source           TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL
    )
  `);
  this.db.run(`CREATE INDEX IF NOT EXISTS idx_graph_from ON graph_edges(from_type, from_id)`);
  this.db.run(`CREATE INDEX IF NOT EXISTS idx_graph_to ON graph_edges(to_type, to_id)`);
  this.db
    .prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)')
    .run(33, new Date().toISOString());
  logger.debug('DB', 'Migration 33 applied: graph_edges table created');
}
```

Then add `this.createGraphEdgesTable();` at the end of the constructor (after the last existing migration call).

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/services/sqlite/__tests__/graph-store.test.ts
```

Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/services/sqlite/migrations/runner.ts src/services/sqlite/__tests__/graph-store.test.ts
git commit -m "feat(graph): add graph_edges SQLite migration (migration 34)"
```

---

## Task 2: GraphStore — edge writes and traversal

**Files:**
- Create: `src/services/sqlite/graph/GraphStore.ts`
- Modify: `src/services/sqlite/__tests__/graph-store.test.ts`

- [ ] **Step 1: Write failing tests for GraphStore**

Add to `src/services/sqlite/__tests__/graph-store.test.ts`:

```typescript
import { GraphStore } from '../graph/GraphStore';

describe('GraphStore', () => {
  let sessionStore: SessionStore;
  let graph: GraphStore;

  beforeEach(() => {
    sessionStore = new SessionStore(':memory:');
    graph = new GraphStore(sessionStore.db);
  });

  it('addEdgePair writes both directions', () => {
    graph.addEdgePair(
      { type: 'observation', id: '1' },
      { type: 'file', id: 'src/foo.ts' },
      'co-file',
      'rule'
    );
    const rows = sessionStore.db
      .prepare('SELECT * FROM graph_edges')
      .all() as any[];
    expect(rows).toHaveLength(2);
    expect(rows.some((r: any) => r.from_id === '1' && r.to_id === 'src/foo.ts')).toBe(true);
    expect(rows.some((r: any) => r.from_id === 'src/foo.ts' && r.to_id === '1')).toBe(true);
  });

  it('traverse returns connected nodes at depth 1', () => {
    graph.addEdgePair({ type: 'observation', id: '1' }, { type: 'file', id: 'src/foo.ts' }, 'co-file', 'rule');
    graph.addEdgePair({ type: 'observation', id: '2' }, { type: 'file', id: 'src/foo.ts' }, 'co-file', 'rule');

    const result = graph.traverse({ type: 'file', id: 'src/foo.ts' }, 1);
    const nodeIds = result.nodes.map((n: any) => n.id);
    expect(nodeIds).toContain('1');
    expect(nodeIds).toContain('2');
    expect(result.edges.length).toBeGreaterThan(0);
  });

  it('traverse does not revisit nodes (no infinite cycles)', () => {
    graph.addEdgePair({ type: 'observation', id: 'A' }, { type: 'observation', id: 'B' }, 'co-concept', 'rule');
    const result = graph.traverse({ type: 'observation', id: 'A' }, 3);
    const nodeIds = result.nodes.map((n: any) => n.id);
    expect(nodeIds.filter((id: string) => id === 'A').length).toBeLessThanOrEqual(1);
  });

  it('addEdge with inTransaction=true does not throw inside a transaction', () => {
    const tx = sessionStore.db.transaction(() => {
      graph.addEdge(
        { type: 'observation', id: '10' },
        { type: 'file', id: 'src/bar.ts' },
        'co-file',
        'rule',
        true
      );
    });
    expect(() => tx()).not.toThrow();
    const rows = sessionStore.db.prepare('SELECT * FROM graph_edges').all();
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/services/sqlite/__tests__/graph-store.test.ts
```

Expected: FAIL — GraphStore module not found.

- [ ] **Step 3: Implement GraphStore**

Create `src/services/sqlite/graph/GraphStore.ts`:

```typescript
import type { Database } from 'bun:sqlite';

export interface GraphNode {
  type: string;
  id: string;
  title?: string;
  created_at?: string;
}

export interface GraphEdge {
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relationship: string;
  source: 'rule' | 'llm';
}

export interface GraphResult {
  center: { type: string; id: string };
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export class GraphStore {
  constructor(private readonly db: Database) {}

  addEdge(
    from: { type: string; id: string },
    to: { type: string; id: string },
    relationship: string,
    source: string,
    inTransaction = false
  ): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_type, from_id, to_type, to_id, relationship, source, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    if (inTransaction) {
      stmt.run(from.type, from.id, to.type, to.id, relationship, source, now);
    } else {
      const tx = this.db.transaction(() => {
        stmt.run(from.type, from.id, to.type, to.id, relationship, source, now);
      });
      tx();
    }
  }

  addEdgePair(
    from: { type: string; id: string },
    to: { type: string; id: string },
    relationship: string,
    source: string,
    inTransaction = false
  ): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO graph_edges
        (from_type, from_id, to_type, to_id, relationship, source, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    const write = () => {
      stmt.run(from.type, from.id, to.type, to.id, relationship, source, now);
      stmt.run(to.type, to.id, from.type, from.id, relationship, source, now);
    };
    if (inTransaction) {
      write();
    } else {
      const tx = this.db.transaction(write);
      tx();
    }
  }

  traverse(center: { type: string; id: string }, depth: number): GraphResult {
    const cap = Math.min(Math.max(depth, 1), 3);

    const rows = this.db.prepare(`
      WITH RECURSIVE traverse(from_type, from_id, to_type, to_id, relationship, source, depth, visited) AS (
        SELECT from_type, from_id, to_type, to_id, relationship, source, 1,
               from_type || ':' || from_id || '|' || to_type || ':' || to_id
        FROM graph_edges
        WHERE from_type = ? AND from_id = ?

        UNION ALL

        SELECT e.from_type, e.from_id, e.to_type, e.to_id, e.relationship, e.source,
               t.depth + 1,
               t.visited || '|' || e.to_type || ':' || e.to_id
        FROM graph_edges e
        JOIN traverse t ON e.from_type = t.to_type AND e.from_id = t.to_id
        WHERE t.depth < ?
          AND instr(t.visited, e.to_type || ':' || e.to_id) = 0
      )
      SELECT DISTINCT from_type, from_id, to_type, to_id, relationship, source FROM traverse
    `).all(center.type, center.id, cap) as GraphEdge[];

    const nodeMap = new Map<string, GraphNode>();
    const centerKey = `${center.type}:${center.id}`;
    for (const edge of rows) {
      const toKey = `${edge.to_type}:${edge.to_id}`;
      if (toKey !== centerKey && !nodeMap.has(toKey)) {
        nodeMap.set(toKey, { type: edge.to_type, id: edge.to_id });
      }
    }

    return {
      center,
      nodes: Array.from(nodeMap.values()),
      edges: rows,
    };
  }

  findLinkedObservations(toType: string, toId: string): string[] {
    const rows = this.db.prepare(`
      SELECT from_id FROM graph_edges
      WHERE to_type = ? AND to_id = ? AND from_type = 'observation'
    `).all(toType, toId) as { from_id: string }[];
    return rows.map((r) => r.from_id);
  }
}
```

- [ ] **Step 4: Run tests**

```bash
bun test src/services/sqlite/__tests__/graph-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full suite**

```bash
bun test
```

Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/services/sqlite/graph/GraphStore.ts src/services/sqlite/__tests__/graph-store.test.ts
git commit -m "feat(graph): add GraphStore with traverse and addEdgePair"
```

---

## Task 3: Pass 1 Rule-Based Edges — Inside Transaction

Write obs→file, obs→concept, obs→session edges inside the `storeObservations` transaction in `transactions.ts`. **Important:** `ResponseProcessor.ts` calls `sessionStore.storeObservations()`, which maps to the `storeObservations` transaction function — NOT `storeObservationsAndMarkComplete`. Add Pass 1 edges inside `storeObservations`.

**Files:**
- Modify: `src/services/sqlite/transactions.ts`
- Modify: `src/services/sqlite/__tests__/graph-store.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/services/sqlite/__tests__/graph-store.test.ts`:

```typescript
import { storeObservationsAndMarkComplete } from '../../transactions';

describe('Pass 1 rule-based edges', () => {
  function makeSessionStore() {
    const ss = new SessionStore(':memory:');
    // Insert a pending message to satisfy the transaction
    const msgId = ss.db
      .prepare(
        "INSERT INTO pending_messages (memory_session_id, project, tool_name, tool_input, tool_response, status) VALUES (?, ?, ?, ?, ?, 'processing')"
      )
      .run('sess-1', 'test-project', 'Edit', '{}', '{}').lastInsertRowid as number;
    return { ss, msgId: Number(msgId) };
  }

  it('writes obs->file edges for files_modified', () => {
    const { ss, msgId } = makeSessionStore();

    storeObservationsAndMarkComplete(
      ss.db,
      'sess-1',
      'test-project',
      [{
        type: 'feature',
        title: 'Test obs',
        subtitle: '',
        facts: [],
        narrative: 'test',
        concepts: [],
        files_read: [],
        files_modified: ['src/foo.ts'],
        generated_by_model: 'test',
      }],
      null,
      msgId
    );

    const edges = ss.db
      .prepare("SELECT * FROM graph_edges WHERE from_type='observation' AND to_type='file'")
      .all() as any[];
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.some((e: any) => e.to_id === 'src/foo.ts')).toBe(true);
  });

  it('writes obs->concept edges', () => {
    const ss2 = new SessionStore(':memory:');
    const msgId2 = Number(ss2.db
      .prepare("INSERT INTO pending_messages (memory_session_id, project, tool_name, tool_input, tool_response, status) VALUES (?, ?, ?, ?, ?, 'processing')")
      .run('sess-2', 'proj', 'Edit', '{}', '{}').lastInsertRowid);

    storeObservationsAndMarkComplete(
      ss2.db, 'sess-2', 'proj',
      [{ type: 'feature', title: 'O', subtitle: '', facts: [], narrative: 'n', concepts: ['auth', 'supabase'], files_read: [], files_modified: [], generated_by_model: 'test' }],
      null, msgId2
    );

    const edges = ss2.db
      .prepare("SELECT * FROM graph_edges WHERE from_type='observation' AND to_type='concept'")
      .all() as any[];
    expect(edges.some((e: any) => e.to_id === 'auth')).toBe(true);
    expect(edges.some((e: any) => e.to_id === 'supabase')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/services/sqlite/__tests__/graph-store.test.ts --test-name-pattern "Pass 1"
```

Expected: FAIL — no edges created yet.

- [ ] **Step 3: Implement Pass 1 in transactions.ts**

Read `src/services/sqlite/transactions.ts` to find the `storeObservations` transaction function (the one called by `sessionStore.storeObservations()` in ResponseProcessor). Inside its `db.transaction()` callback, after each observation INSERT where `result.lastInsertRowid` is available, add:

```typescript
// Pass 1: write rule-based graph edges (plain run, no nested transaction)
const obsId = String(Number(result.lastInsertRowid));
const edgeNow = Date.now();
const edgeStmt = db.prepare(`
  INSERT OR IGNORE INTO graph_edges
    (from_type, from_id, to_type, to_id, relationship, source, created_at_epoch)
  VALUES (?, ?, ?, ?, ?, 'rule', ?)
`);

// obs <-> session
edgeStmt.run('observation', obsId, 'session', memorySessionId, 'co-session', edgeNow);
edgeStmt.run('session', memorySessionId, 'observation', obsId, 'co-session', edgeNow);

// obs <-> file
const filesRead: string[] = Array.isArray(observation.files_read)
  ? observation.files_read
  : JSON.parse((observation.files_read as string) || '[]');
const filesModified: string[] = Array.isArray(observation.files_modified)
  ? observation.files_modified
  : JSON.parse((observation.files_modified as string) || '[]');

for (const file of [...filesRead, ...filesModified]) {
  edgeStmt.run('observation', obsId, 'file', file, 'co-file', edgeNow);
  edgeStmt.run('file', file, 'observation', obsId, 'co-file', edgeNow);
}

// obs <-> concept
const concepts: string[] = Array.isArray(observation.concepts)
  ? observation.concepts
  : JSON.parse((observation.concepts as string) || '[]');
for (const concept of concepts) {
  edgeStmt.run('observation', obsId, 'concept', concept, 'co-concept', edgeNow);
  edgeStmt.run('concept', concept, 'observation', obsId, 'co-concept', edgeNow);
}
```

Note: `observation.files_read`, `observation.files_modified`, and `observation.concepts` in the `ObservationInput` type may be arrays or strings depending on serialization. The array-check guard above handles both. Verify the actual `ObservationInput` type and adjust if needed.

- [ ] **Step 4: Run tests**

```bash
bun test src/services/sqlite/__tests__/graph-store.test.ts
```

Expected: all pass.

- [ ] **Step 5: Run full suite**

```bash
bun test
```

Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/services/sqlite/transactions.ts src/services/sqlite/__tests__/graph-store.test.ts
git commit -m "feat(graph): write Pass 1 rule-based edges inside storeObservations transaction"
```

---

## Task 4: Pass 2 Cross-Link Edges — After Transaction

Write obs→obs edges in `ResponseProcessor.ts` after `storeObservations()` returns.

**Files:**
- Modify: `src/services/worker/agents/ResponseProcessor.ts`

- [ ] **Step 1: Write test**

Add to `src/services/sqlite/__tests__/graph-store.test.ts`:

```typescript
describe('Pass 2 cross-link logic', () => {
  it('findLinkedObservations returns IDs sharing a file', () => {
    const ss = new SessionStore(':memory:');
    const g = new GraphStore(ss.db);
    g.addEdgePair({ type: 'observation', id: '1' }, { type: 'file', id: 'src/foo.ts' }, 'co-file', 'rule');
    g.addEdgePair({ type: 'observation', id: '2' }, { type: 'file', id: 'src/foo.ts' }, 'co-file', 'rule');

    const linked = g.findLinkedObservations('file', 'src/foo.ts');
    expect(linked).toContain('1');
    expect(linked).toContain('2');
  });
});
```

- [ ] **Step 2: Run test**

```bash
bun test src/services/sqlite/__tests__/graph-store.test.ts --test-name-pattern "Pass 2"
```

Expected: PASS (GraphStore.findLinkedObservations already implemented).

- [ ] **Step 3: Implement Pass 2 in ResponseProcessor.ts**

Read `src/services/worker/agents/ResponseProcessor.ts` to find the `storeObservations()` call. Immediately after `const result = sessionStore.storeObservations(...)`:

```typescript
// Pass 2: cross-link observations sharing files/concepts (runs after transaction commits)
try {
  const { GraphStore } = await import('../../sqlite/graph/GraphStore');
  const graphStore = new GraphStore(sessionStore.db);
  for (const obsId of result.observationIds) {
    const obsIdStr = String(obsId);
    // Files this observation is linked to
    const fileEdges = sessionStore.db
      .prepare("SELECT to_id FROM graph_edges WHERE from_type='observation' AND from_id=? AND to_type='file'")
      .all(obsIdStr) as { to_id: string }[];
    for (const { to_id: file } of fileEdges) {
      const linked = graphStore.findLinkedObservations('file', file);
      for (const existingId of linked) {
        if (existingId !== obsIdStr) {
          graphStore.addEdgePair(
            { type: 'observation', id: obsIdStr },
            { type: 'observation', id: existingId },
            'co-file',
            'rule'
          );
        }
      }
    }
    // Concepts this observation is linked to
    const conceptEdges = sessionStore.db
      .prepare("SELECT to_id FROM graph_edges WHERE from_type='observation' AND from_id=? AND to_type='concept'")
      .all(obsIdStr) as { to_id: string }[];
    for (const { to_id: concept } of conceptEdges) {
      const linked = graphStore.findLinkedObservations('concept', concept);
      for (const existingId of linked) {
        if (existingId !== obsIdStr) {
          graphStore.addEdgePair(
            { type: 'observation', id: obsIdStr },
            { type: 'observation', id: existingId },
            'co-concept',
            'rule'
          );
        }
      }
    }
  }
} catch (err) {
  logger.warn('GRAPH', `Pass 2 cross-link failed: ${err}`);
}
```

If the file uses top-level imports rather than dynamic import, add `import { GraphStore } from '../../sqlite/graph/GraphStore';` at the top instead and remove the `await import(...)`.

- [ ] **Step 4: Run full suite**

```bash
bun test
```

Expected: no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/services/worker/agents/ResponseProcessor.ts
git commit -m "feat(graph): write Pass 2 cross-link obs->obs edges in ResponseProcessor"
```

---

## Task 5: GraphEdgeExtractor — LLM Semantic Edges

**Files:**
- Create: `src/services/sync/GraphEdgeExtractor.ts`
- Create: `src/services/sync/__tests__/GraphEdgeExtractor.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/services/sync/__tests__/GraphEdgeExtractor.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { GraphEdgeExtractor } from '../GraphEdgeExtractor';
import { SessionStore } from '../../sqlite/SessionStore';
import { GraphStore } from '../../sqlite/graph/GraphStore';

describe('GraphEdgeExtractor', () => {
  it('returns empty array when disabled', async () => {
    const ss = new SessionStore(':memory:');
    const g = new GraphStore(ss.db);
    const extractor = new GraphEdgeExtractor({ enabled: false, llm: async () => '[]', graph: g });
    const result = await extractor.extract({ observations: [{ id: '1', title: 'T', narrative: 'n' }] });
    expect(result).toEqual([]);
  });

  it('parses LLM response and writes edges', async () => {
    const ss = new SessionStore(':memory:');
    const g = new GraphStore(ss.db);
    const extractor = new GraphEdgeExtractor({
      enabled: true,
      llm: async () => JSON.stringify([{ from_id: '1', to_id: '2', relationship: 'contradicts' }]),
      graph: g,
    });
    await extractor.extract({
      observations: [
        { id: '1', title: 'Obs 1', narrative: 'says X' },
        { id: '2', title: 'Obs 2', narrative: 'says not X' },
      ],
    });
    const edges = ss.db
      .prepare("SELECT * FROM graph_edges WHERE relationship='contradicts'")
      .all() as any[];
    expect(edges.length).toBeGreaterThan(0);
  });

  it('does not throw on invalid LLM JSON', async () => {
    const ss = new SessionStore(':memory:');
    const g = new GraphStore(ss.db);
    const extractor = new GraphEdgeExtractor({ enabled: true, llm: async () => 'not json', graph: g });
    await expect(extractor.extract({ observations: [{ id: '1', title: 'T', narrative: 'n' }] })).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/services/sync/__tests__/GraphEdgeExtractor.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement GraphEdgeExtractor**

Create `src/services/sync/GraphEdgeExtractor.ts`:

```typescript
import type { GraphStore } from '../sqlite/graph/GraphStore';

export interface GraphEdgeInput {
  observations: { id: string; title: string; narrative: string }[];
}

export interface ExtractedEdge {
  from_id: string;
  to_id: string;
  relationship: 'contradicts' | 'depends-on' | 'supersedes' | 'confirms';
}

export interface GraphEdgeExtractorConfig {
  enabled: boolean;
  llm: (prompt: string) => Promise<string>;
  graph: GraphStore;
}

function buildPrompt(input: GraphEdgeInput): string {
  const obs = input.observations
    .map((o) => `ID: ${o.id}\nTitle: ${o.title}\nNarrative: ${o.narrative}`)
    .join('\n\n');
  return `Analyze these observations and identify relationships between them.
Return a JSON array of objects:
[{"from_id":"string","to_id":"string","relationship":"contradicts|depends-on|supersedes|confirms"}]

Only include pairs with a clear relationship. Return [] if none.

Observations:
${obs}

Return JSON only.`;
}

function parseEdges(text: string): ExtractedEdge[] {
  try {
    const parsed = JSON.parse(text.trim());
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is ExtractedEdge =>
        typeof e.from_id === 'string' &&
        typeof e.to_id === 'string' &&
        ['contradicts', 'depends-on', 'supersedes', 'confirms'].includes(e.relationship)
    );
  } catch {
    return [];
  }
}

export class GraphEdgeExtractor {
  constructor(private readonly config: GraphEdgeExtractorConfig) {}

  async extract(input: GraphEdgeInput): Promise<ExtractedEdge[]> {
    if (!this.config.enabled) return [];
    if (input.observations.length < 2) return [];
    const prompt = buildPrompt(input);
    try {
      const text = await this.config.llm(prompt);
      const edges = parseEdges(text);
      for (const edge of edges) {
        this.config.graph.addEdgePair(
          { type: 'observation', id: edge.from_id },
          { type: 'observation', id: edge.to_id },
          edge.relationship,
          'llm'
        );
      }
      return edges;
    } catch (err) {
      console.error('[GraphEdgeExtractor] extract error:', err);
      return [];
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
bun test src/services/sync/__tests__/GraphEdgeExtractor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full suite**

```bash
bun test
```

Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/services/sync/GraphEdgeExtractor.ts src/services/sync/__tests__/GraphEdgeExtractor.test.ts
git commit -m "feat(graph): add GraphEdgeExtractor for LLM semantic edges"
```

---

## Task 6: SyncWorker Integration

**Files:**
- Modify: `src/services/sync/SyncWorker.ts`
- Possibly modify: `src/services/sqlite/SessionStore.ts` (if `getSessionObservations` doesn't exist)

- [ ] **Step 1: Read SyncWorker and check SessionStore**

Read `src/services/sync/SyncWorker.ts` lines 1–250 to understand the constructor, `extractionEnabled` flag, and `extractSessionLearnings` pattern.

Check if `SessionStore` has a method to get observations for a session ID: `grep -n "getSession" src/services/sqlite/SessionStore.ts`

- [ ] **Step 2: Add getSessionObservations to SessionStore if missing**

If `SessionStore` has no method to fetch observations by session DB ID, add to `src/services/sqlite/SessionStore.ts`:

```typescript
getSessionObservations(sessionDbId: number): { id: number; title: string; narrative: string }[] {
  const session = this.getSession(sessionDbId);
  if (!session) return [];
  return this.db
    .prepare('SELECT id, title, narrative FROM observations WHERE memory_session_id = ?')
    .all(session.memorySessionId) as { id: number; title: string; narrative: string }[];
}
```

Check the `getSession` method signature to confirm the parameter type and what it returns (specifically the `memorySessionId` field name).

- [ ] **Step 3: Wire GraphEdgeExtractor in SyncWorker**

In `src/services/sync/SyncWorker.ts`:

1. Add import: `import { GraphEdgeExtractor } from './GraphEdgeExtractor';`
2. Add import: `import { GraphStore } from '../sqlite/graph/GraphStore';`
3. Add private field: `private graphExtractor: GraphEdgeExtractor | null = null;`
4. In the constructor block where `LearningExtractor` is created (inside the `if (this.extractionEnabled)` check), also create the graph extractor:

```typescript
this.graphExtractor = new GraphEdgeExtractor({
  enabled: true,
  llm: config.llm,  // same field used by ConflictDetector in SyncWorkerConfig
  graph: new GraphStore(this.sessionStore.db),
});
```

5. In the tick loop, after `await this.extractSessionLearnings(s.id)`:

```typescript
if (this.graphExtractor) {
  try {
    const observations = this.sessionStore.getSessionObservations(s.id);
    await this.graphExtractor.extract({
      observations: observations.map((o) => ({
        id: String(o.id),
        title: o.title || '',
        narrative: o.narrative || '',
      })),
    });
  } catch { /* non-blocking */ }
}
```

- [ ] **Step 4: Run full test suite**

```bash
bun test
```

Expected: no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/services/sync/SyncWorker.ts src/services/sqlite/SessionStore.ts
git commit -m "feat(graph): trigger GraphEdgeExtractor at session-end in SyncWorker"
```

---

## Task 7: GraphRoutes — API Endpoint

**Files:**
- Create: `src/services/worker/http/routes/GraphRoutes.ts`
- Modify: `src/services/worker-service.ts`

- [ ] **Step 1: Read an existing route file for the pattern**

Read `src/services/worker/http/routes/TickRoutes.ts` or `AdminRoutes.ts` to understand BaseRoutes, wrapHandler, and constructor injection pattern before writing.

- [ ] **Step 2: Implement GraphRoutes**

Create `src/services/worker/http/routes/GraphRoutes.ts` following the same pattern as existing routes:

```typescript
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import type { Application, Request, Response } from 'express';
import type { DatabaseManager } from '../../worker/DatabaseManager';
import { GraphStore } from '../../../sqlite/graph/GraphStore';
import { BaseRouteHandler } from '../BaseRouteHandler.js';  // adjust path to match existing routes

export class GraphRoutes extends BaseRouteHandler {
  constructor(private readonly dbManager: DatabaseManager) {
    super();
  }

  setupRoutes(app: Application): void {
    app.get('/api/graph', this.wrapHandler(this.handleGraph.bind(this)));
  }

  private handleGraph(req: Request, res: Response): void {
    const entity = req.query['entity'] as string | undefined;
    const type = req.query['type'] as string | undefined;
    const depthStr = req.query['depth'] as string | undefined;

    if (!entity || !type) {
      res.status(400).json({ error: 'entity and type are required' });
      return;
    }

    const validTypes = ['observation', 'file', 'concept', 'session'];
    if (!validTypes.includes(type)) {
      res.status(400).json({ error: 'type must be one of: ' + validTypes.join(', ') });
      return;
    }

    const depth = Math.min(Math.max(parseInt(depthStr || '2', 10) || 2, 1), 3);
    const sessionStore = this.dbManager.getSessionStore();
    const graph = new GraphStore(sessionStore.db);
    const result = graph.traverse({ type, id: entity }, depth);

    res.json(result);
  }
}
```

Verify the `BaseRoutes` import path by checking what existing routes like `TickRoutes.ts` import. Adjust to match.

- [ ] **Step 3: Register in worker-service.ts**

In `src/services/worker-service.ts`, inside `registerRoutes()`:

```typescript
this.server.registerRoutes(new GraphRoutes(this.dbManager));
```

Add at top: `import { GraphRoutes } from './worker/http/routes/GraphRoutes';`

- [ ] **Step 4: Build and restart**

```bash
npm run build-and-sync
```

- [ ] **Step 5: Smoke test**

```bash
curl "http://localhost:37777/api/graph?entity=src/foo.ts&type=file&depth=2"
```

Expected: JSON `{ center: {...}, nodes: [...], edges: [...] }` — may be empty arrays.

```bash
curl "http://localhost:37777/api/graph"
```

Expected: 400 `{ error: 'entity and type are required' }`

- [ ] **Step 6: Run full suite**

```bash
bun test
```

Expected: no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/services/worker/http/routes/GraphRoutes.ts src/services/worker-service.ts
git commit -m "feat(graph): add GET /api/graph endpoint"
```

---

## Task 8: MCP Tool

**Files:**
- Modify: `src/servers/mcp-server.ts`

- [ ] **Step 1: Add TOOL_ENDPOINT_MAP entry**

In `src/servers/mcp-server.ts`, find the `TOOL_ENDPOINT_MAP` object and add:

```typescript
'graph': '/api/graph',
```

- [ ] **Step 2: Add graph tool to tools array**

Append to the `tools` array in `mcp-server.ts`:

```typescript
{
  name: 'graph',
  description: 'Traverse the memory graph to find everything connected to a file, concept, or observation. Use to answer "what touched X?" or "what relates to Y?". Returns linked observations, files, concepts, and typed LLM edges.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'File path (has / or extension), observation ID (number), or concept name.'
      },
      depth: {
        type: 'number',
        description: 'Traversal depth 1-3 (default 2)'
      }
    },
    required: ['query'],
    additionalProperties: false
  },
  handler: async (args: { query: string; depth?: number }) => {
    const q = args.query;
    let type: string;
    if (/^\d+$/.test(q)) {
      type = 'observation';
    } else if (q.indexOf('/') !== -1 || /\.\w{1,5}$/.test(q)) {
      type = 'file';
    } else {
      type = 'concept';
    }
    const depth = args.depth || 2;
    const result = await callWorkerAPI('/api/graph', { entity: q, type: type, depth: depth });

    if (!result || !result.nodes) return 'No graph data found for "' + q + '"';

    var observations = result.nodes.filter(function(n: any) { return n.type === 'observation'; });
    var files = result.nodes.filter(function(n: any) { return n.type === 'file'; });
    var concepts = result.nodes.filter(function(n: any) { return n.type === 'concept'; });
    var llmEdges = result.edges.filter(function(e: any) { return e.source === 'llm'; });

    var lines = [
      'Graph: ' + q + ' (depth ' + depth + ', ' + result.nodes.length + ' nodes)',
      '',
      'Observations (' + observations.length + '):',
    ];
    observations.slice(0, 10).forEach(function(n: any) {
      lines.push('  #' + n.id + ' "' + (n.title || '') + '"');
    });
    if (observations.length > 10) lines.push('  ... and ' + (observations.length - 10) + ' more');
    lines.push('');
    lines.push('Concepts (' + concepts.length + '): ' + concepts.map(function(n: any) { return n.id; }).join(' · '));
    lines.push('Files (' + files.length + '): ' + files.map(function(n: any) { return n.id; }).join(' · '));

    if (llmEdges.length > 0) {
      lines.push('', 'LLM edges:');
      llmEdges.slice(0, 10).forEach(function(e: any) {
        lines.push('  #' + e.from_id + ' ' + e.relationship + ' #' + e.to_id);
      });
    }
    if (observations.length > 0) {
      var ids = observations.slice(0, 5).map(function(n: any) { return n.id; }).join(', ');
      lines.push('', 'Use get_observations([' + ids + ']) for full details.');
    }
    return lines.filter(function(l: string) { return l !== ''; }).join('\n');
  }
},
```

- [ ] **Step 3: Build**

```bash
npm run build-and-sync
```

- [ ] **Step 4: Run full suite**

```bash
bun test
```

Expected: no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/servers/mcp-server.ts
git commit -m "feat(graph): add graph MCP tool"
```

---

## Task 9: Brutalist Graph UI

**Files:**
- Create: `plugin/ui/graph.html`
- Modify: `src/services/worker/http/routes/ViewerRoutes.ts`

- [ ] **Step 1: Add route to ViewerRoutes.ts**

In `src/services/worker/http/routes/ViewerRoutes.ts`:

1. Register route in `setupRoutes()`:
```typescript
app.get('/graph', this.handleGraphUI.bind(this));
```

2. Add handler method (copy the pattern from `handleAdminUI` or `handleTicksUI`):
```typescript
private handleGraphUI = this.wrapHandler((_req: Request, res: Response): void => {
  const packageRoot = getPackageRoot();
  const candidatePaths = [
    path.join(packageRoot, 'ui', 'graph.html'),
    path.join(packageRoot, 'plugin', 'ui', 'graph.html'),
  ];
  const htmlPath = candidatePaths.find((p) => existsSync(p));
  if (!htmlPath) throw new Error('Graph UI not found');
  const html = readFileSync(htmlPath, 'utf-8');
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});
```

- [ ] **Step 2: Copy brutalist CSS from ticks.html**

Read `plugin/ui/ticks.html` and copy the full `<style>` block contents.

- [ ] **Step 3: Create graph.html**

Create `plugin/ui/graph.html`. Requirements:
- ES5 compatible — no `let`, `const`, arrow functions, template literals, or `forEach` with arrow functions
- All data rendered with `textContent` or DOM methods — **no `innerHTML` with data values**
- Nav bar with links to Sessions / Admin / Ticks / Graph (Graph highlighted)
- Search bar: text input, type selector (file/concept/observation/session), depth selector (1/2/3), SEARCH button
- Results area: center node box, three columns (OBSERVATIONS | CONCEPTS | FILES), LLM EDGES table
- Empty state message, error state message

Key DOM-safe rendering pattern (use throughout):
```javascript
// SAFE: use textContent, not innerHTML
var cell = document.createElement('td');
cell.textContent = someDataValue;
row.appendChild(cell);
```

Full implementation — use this as the starting point and fill in the brutalist CSS from ticks.html:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ENGRAM GRAPH</title>
  <style>
    /* PASTE brutalist CSS from plugin/ui/ticks.html here */
  </style>
</head>
<body>
  <div class="nav">
    <span>&#11041; ENGRAM WORKER</span>
    <span style="margin-left:20px">
      <a href="/" class="nav-link">Sessions</a>
      <span class="nav-sep">|</span>
      <a href="/admin" class="nav-link">Admin</a>
      <span class="nav-sep">|</span>
      <a href="/ticks" class="nav-link">Ticks</a>
      <span class="nav-sep">|</span>
      <a href="/graph" class="nav-link nav-active">Graph</a>
    </span>
  </div>

  <div style="padding:20px">
    <h1 style="margin:0 0 16px 0">MEMORY GRAPH</h1>

    <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;align-items:center">
      <input type="text" id="entityInput" placeholder="SupabaseManager.ts or auth or 1234"
        style="flex:1;min-width:200px;font-family:inherit;border:3px solid #000;padding:8px">
      <select id="typeSelect" style="font-family:inherit;border:3px solid #000;padding:8px">
        <option value="file">file</option>
        <option value="concept">concept</option>
        <option value="observation">observation</option>
        <option value="session">session</option>
      </select>
      <select id="depthSelect" style="font-family:inherit;border:3px solid #000;padding:8px">
        <option value="1">depth 1</option>
        <option value="2" selected>depth 2</option>
        <option value="3">depth 3</option>
      </select>
      <button onclick="doSearch()" style="font-family:inherit;border:3px solid #000;padding:8px 16px;background:#000;color:#fff;cursor:pointer">SEARCH</button>
    </div>

    <div id="centerBox" style="display:none;border:3px solid #000;padding:12px;margin-bottom:16px;background:#f0f0f0">
      <strong id="centerLabel"></strong>
      <span id="nodeCount" style="margin-left:12px;color:#666;font-size:0.9em"></span>
    </div>

    <div id="results" style="display:none">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px">
        <div>
          <h3 style="margin:0 0 8px 0;border-bottom:3px solid #000;padding-bottom:4px">OBSERVATIONS</h3>
          <div id="obsCol"></div>
        </div>
        <div>
          <h3 style="margin:0 0 8px 0;border-bottom:3px solid #000;padding-bottom:4px">CONCEPTS</h3>
          <div id="conceptCol"></div>
        </div>
        <div>
          <h3 style="margin:0 0 8px 0;border-bottom:3px solid #000;padding-bottom:4px">FILES</h3>
          <div id="fileCol"></div>
        </div>
      </div>

      <div id="llmSection" style="display:none">
        <h3 style="margin:0 0 8px 0;border-bottom:3px solid #000;padding-bottom:4px">LLM EDGES</h3>
        <table style="border-collapse:collapse;width:100%">
          <thead>
            <tr>
              <th style="background:#000;color:#fff;padding:8px;text-align:left">FROM</th>
              <th style="background:#000;color:#fff;padding:8px;text-align:left">RELATIONSHIP</th>
              <th style="background:#000;color:#fff;padding:8px;text-align:left">TO</th>
            </tr>
          </thead>
          <tbody id="llmBody"></tbody>
        </table>
      </div>
    </div>

    <div id="emptyBox" style="display:none;padding:12px;color:#666;border:3px solid #ccc">No connections found.</div>
    <div id="errorBox" style="display:none;padding:12px;color:#c00;border:3px solid #c00"></div>
  </div>

  <script>
    function hide(id) { document.getElementById(id).style.display = 'none'; }
    function show(id, display) { document.getElementById(id).style.display = display || 'block'; }
    function setText(id, text) { document.getElementById(id).textContent = text; }

    function doSearch() {
      var entity = document.getElementById('entityInput').value.trim();
      var type = document.getElementById('typeSelect').value;
      var depth = document.getElementById('depthSelect').value;
      if (!entity) return;

      hide('results'); hide('centerBox'); hide('emptyBox'); hide('errorBox');
      document.getElementById('obsCol').textContent = '';
      document.getElementById('conceptCol').textContent = '';
      document.getElementById('fileCol').textContent = '';
      document.getElementById('llmBody').textContent = '';

      var url = '/api/graph?entity=' + encodeURIComponent(entity)
        + '&type=' + encodeURIComponent(type)
        + '&depth=' + encodeURIComponent(depth);

      var xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.onload = function() {
        if (xhr.status !== 200) {
          setText('errorBox', 'Error ' + xhr.status + ': ' + xhr.responseText);
          show('errorBox');
          return;
        }
        var data;
        try { data = JSON.parse(xhr.responseText); } catch (e) {
          setText('errorBox', 'Invalid response');
          show('errorBox');
          return;
        }
        renderResult(data);
      };
      xhr.onerror = function() {
        setText('errorBox', 'Network error');
        show('errorBox');
      };
      xhr.send();
    }

    function makeCard(text) {
      var div = document.createElement('div');
      div.style.cssText = 'border:2px solid #000;padding:8px;margin-bottom:6px;word-break:break-all';
      div.textContent = text;
      return div;
    }

    function renderResult(data) {
      if (!data.nodes || data.nodes.length === 0) { show('emptyBox'); return; }

      var center = data.center;
      setText('centerLabel', center.type + ': ' + center.id);
      setText('nodeCount', data.nodes.length + ' connected nodes');
      show('centerBox');

      var observations = [];
      var concepts = [];
      var files = [];
      var llmEdges = [];

      var i;
      for (i = 0; i < data.nodes.length; i++) {
        var n = data.nodes[i];
        if (n.type === 'observation') observations.push(n);
        else if (n.type === 'concept') concepts.push(n);
        else if (n.type === 'file') files.push(n);
      }
      for (i = 0; i < data.edges.length; i++) {
        if (data.edges[i].source === 'llm') llmEdges.push(data.edges[i]);
      }

      var obsCol = document.getElementById('obsCol');
      for (i = 0; i < observations.length; i++) {
        var n = observations[i];
        var card = document.createElement('div');
        card.style.cssText = 'border:2px solid #000;padding:8px;margin-bottom:6px';
        var a = document.createElement('a');
        a.href = '/?id=' + encodeURIComponent(n.id);
        a.textContent = '#' + n.id + ' ' + (n.title || '');
        card.appendChild(a);
        if (n.created_at) {
          var ts = document.createElement('div');
          ts.style.cssText = 'color:#666;font-size:0.85em;margin-top:2px';
          ts.textContent = n.created_at.slice(0, 10);
          card.appendChild(ts);
        }
        obsCol.appendChild(card);
      }

      var conceptCol = document.getElementById('conceptCol');
      for (i = 0; i < concepts.length; i++) {
        conceptCol.appendChild(makeCard(concepts[i].id));
      }

      var fileCol = document.getElementById('fileCol');
      for (i = 0; i < files.length; i++) {
        fileCol.appendChild(makeCard(files[i].id));
      }

      if (llmEdges.length > 0) {
        var tbody = document.getElementById('llmBody');
        for (i = 0; i < llmEdges.length; i++) {
          var e = llmEdges[i];
          var tr = document.createElement('tr');
          var td1 = document.createElement('td');
          td1.style.cssText = 'border:1px solid #000;padding:8px';
          td1.textContent = '#' + e.from_id;
          var td2 = document.createElement('td');
          td2.style.cssText = 'border:1px solid #000;padding:8px;font-weight:bold';
          td2.textContent = e.relationship;
          var td3 = document.createElement('td');
          td3.style.cssText = 'border:1px solid #000;padding:8px';
          td3.textContent = '#' + e.to_id;
          tr.appendChild(td1);
          tr.appendChild(td2);
          tr.appendChild(td3);
          tbody.appendChild(tr);
        }
        show('llmSection');
      }

      show('results');
    }

    document.getElementById('entityInput').onkeydown = function(e) {
      if (e.keyCode === 13) doSearch();
    };
  </script>
</body>
</html>
```

- [ ] **Step 4: Build and sync**

```bash
npm run build-and-sync
```

- [ ] **Step 5: Verify graph page loads**

Open `http://localhost:37777/graph` in a browser. Confirm:
- Nav bar visible with Graph highlighted
- Search bar, type/depth selectors visible
- No console errors

- [ ] **Step 6: Smoke test a search**

Search for any concept name or file path. With no graph data: "No connections found." With data: three columns show nodes.

- [ ] **Step 7: Run full test suite**

```bash
bun test
```

Expected: no regressions.

- [ ] **Step 8: Commit**

```bash
git add plugin/ui/graph.html src/services/worker/http/routes/ViewerRoutes.ts
git commit -m "feat(graph): add brutalist graph UI at /graph"
```

---

## Task 10: End-to-End Verification

- [ ] **Step 1: Run full test suite**

```bash
bun test
```

Expected: all pass.

- [ ] **Step 2: Build and restart**

```bash
npm run build-and-sync
```

- [ ] **Step 3: Verify edges are being written**

Trigger a tool call inside any Claude Code session (e.g., read a file). Then:

```bash
sqlite3 ~/.engram/claude-mem.db "SELECT count(*) FROM graph_edges;"
# If that path fails, try: sqlite3 ~/.claude-mem/claude-mem.db "SELECT count(*) FROM graph_edges;"
```

Expected: row count > 0.

- [ ] **Step 4: Test the API**

```bash
# Find a file that has been observed
sqlite3 ~/.engram/claude-mem.db "SELECT DISTINCT to_id FROM graph_edges WHERE to_type='file' LIMIT 3;"

# Query the graph for one of those files
FILE="<paste a path from above>"
curl "http://localhost:37777/api/graph?entity=${FILE}&type=file&depth=2" | head -200
```

Expected: JSON with `center`, `nodes`, `edges`.

- [ ] **Step 5: Test UI end-to-end**

Open `http://localhost:37777/graph`, search for a file from Step 4. Verify observations appear in the OBSERVATIONS column, files in FILES column.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(graph): memory graph complete — traversal, edges, MCP tool, UI"
```
