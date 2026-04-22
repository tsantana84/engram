import { describe, it, expect, beforeEach } from 'bun:test';
import { storeObservations } from '../transactions';
import { SessionStore } from '../SessionStore';
import { GraphStore } from '../graph/GraphStore';

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
    const rows = sessionStore.db.prepare('SELECT * FROM graph_edges').all() as any[];
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

  it('findLinkedObservations returns IDs sharing a file', () => {
    graph.addEdgePair({ type: 'observation', id: '1' }, { type: 'file', id: 'src/foo.ts' }, 'co-file', 'rule');
    graph.addEdgePair({ type: 'observation', id: '2' }, { type: 'file', id: 'src/foo.ts' }, 'co-file', 'rule');
    const linked = graph.findLinkedObservations('file', 'src/foo.ts');
    expect(linked).toContain('1');
    expect(linked).toContain('2');
  });

  it('traverse handles observation IDs that are substrings of each other', () => {
    // ID '12' should not block traversal of '123'
    graph.addEdgePair({ type: 'observation', id: '12' }, { type: 'file', id: 'src/foo.ts' }, 'co-file', 'rule');
    graph.addEdgePair({ type: 'observation', id: '123' }, { type: 'file', id: 'src/foo.ts' }, 'co-file', 'rule');
    const result = graph.traverse({ type: 'file', id: 'src/foo.ts' }, 2);
    const nodeIds = result.nodes.map((n: any) => n.id);
    expect(nodeIds).toContain('12');
    expect(nodeIds).toContain('123');
  });

  it('addEdgePair does not create duplicate edges', () => {
    graph.addEdgePair({ type: 'observation', id: '1' }, { type: 'file', id: 'src/foo.ts' }, 'co-file', 'rule');
    graph.addEdgePair({ type: 'observation', id: '1' }, { type: 'file', id: 'src/foo.ts' }, 'co-file', 'rule');
    const rows = sessionStore.db.prepare('SELECT * FROM graph_edges').all();
    expect(rows).toHaveLength(2); // Still 2 (bidirectional), not 4
  });
});

function createSessionWithMemoryId(store: SessionStore, memorySessionId: string): void {
  const contentSessionId = 'content-' + memorySessionId;
  store.createSDKSession(contentSessionId, 'test-project', 'test prompt');
  store.db.prepare(
    'UPDATE sdk_sessions SET memory_session_id = ? WHERE content_session_id = ?'
  ).run(memorySessionId, contentSessionId);
}

describe('Pass 1 rule-based edges', () => {
  let sessionStore: SessionStore;

  beforeEach(() => {
    sessionStore = new SessionStore(':memory:');
  });

  it('writes obs->file edges for files_modified', () => {
    const sessionId = 'test-session-' + Date.now();
    createSessionWithMemoryId(sessionStore, sessionId);

    storeObservations(
      sessionStore.db,
      sessionId,
      'test-project',
      [{
        type: 'implementation',
        title: 'Test Observation',
        subtitle: null,
        facts: [],
        narrative: 'Did some work',
        concepts: [],
        files_read: [],
        files_modified: ['src/foo.ts', 'src/bar.ts'],
      }],
      null
    );

    const rows = sessionStore.db
      .prepare("SELECT * FROM graph_edges WHERE to_type = 'file'")
      .all() as any[];

    expect(rows.length).toBeGreaterThanOrEqual(2);
    const toIds = rows.map((r: any) => r.to_id);
    expect(toIds).toContain('src/foo.ts');
    expect(toIds).toContain('src/bar.ts');
    expect(rows.every((r: any) => r.from_type === 'observation')).toBe(true);
  });

  it('writes obs->session edges', () => {
    const sessionId = 'test-session-' + Date.now();
    createSessionWithMemoryId(sessionStore, sessionId);

    storeObservations(
      sessionStore.db,
      sessionId,
      'test-project',
      [{
        type: 'implementation',
        title: 'Test Observation',
        subtitle: null,
        facts: [],
        narrative: 'Did some work',
        concepts: [],
        files_read: [],
        files_modified: [],
      }],
      null
    );

    const rows = sessionStore.db
      .prepare("SELECT * FROM graph_edges WHERE to_type = 'session' AND to_id = ?")
      .all(sessionId) as any[];

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].from_type).toBe('observation');
    expect(rows[0].relationship).toBe('co-session');
  });

  it('writes obs->concept edges', () => {
    const sessionId = 'test-session-' + Date.now();
    createSessionWithMemoryId(sessionStore, sessionId);

    storeObservations(
      sessionStore.db,
      sessionId,
      'test-project',
      [{
        type: 'implementation',
        title: 'Test Observation',
        subtitle: null,
        facts: [],
        narrative: 'Did some work',
        concepts: ['graph', 'sqlite'],
        files_read: [],
        files_modified: [],
      }],
      null
    );

    const rows = sessionStore.db
      .prepare("SELECT * FROM graph_edges WHERE to_type = 'concept'")
      .all() as any[];

    expect(rows.length).toBeGreaterThanOrEqual(2);
    const toIds = rows.map((r: any) => r.to_id);
    expect(toIds).toContain('graph');
    expect(toIds).toContain('sqlite');
  });

  it('writes reverse edges (file->obs, concept->obs, session->obs)', () => {
    const sessionId = 'test-session-' + Date.now();
    createSessionWithMemoryId(sessionStore, sessionId);

    storeObservations(
      sessionStore.db,
      sessionId,
      'test-project',
      [{
        type: 'implementation',
        title: 'Test Observation',
        subtitle: null,
        facts: [],
        narrative: 'Did some work',
        concepts: ['graph'],
        files_read: ['src/foo.ts'],
        files_modified: [],
      }],
      null
    );

    const fileToObs = sessionStore.db
      .prepare("SELECT * FROM graph_edges WHERE from_type = 'file' AND from_id = 'src/foo.ts' AND to_type = 'observation'")
      .all() as any[];
    expect(fileToObs.length).toBe(1);

    const conceptToObs = sessionStore.db
      .prepare("SELECT * FROM graph_edges WHERE from_type = 'concept' AND from_id = 'graph' AND to_type = 'observation'")
      .all() as any[];
    expect(conceptToObs.length).toBe(1);

    const sessionToObs = sessionStore.db
      .prepare("SELECT * FROM graph_edges WHERE from_type = 'session' AND from_id = ? AND to_type = 'observation'")
      .all(sessionId) as any[];
    expect(sessionToObs.length).toBe(1);
  });
});

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
