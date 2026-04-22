import { describe, it, expect, beforeEach } from 'bun:test';
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
});
