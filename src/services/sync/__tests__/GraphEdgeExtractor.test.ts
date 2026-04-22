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

  it('returns empty array when fewer than 2 observations', async () => {
    const ss = new SessionStore(':memory:');
    const g = new GraphStore(ss.db);
    const extractor = new GraphEdgeExtractor({ enabled: true, llm: async () => '[{"from_id":"1","to_id":"2","relationship":"contradicts"}]', graph: g });
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
    await expect(extractor.extract({ observations: [
      { id: '1', title: 'T', narrative: 'n' },
      { id: '2', title: 'T2', narrative: 'n2' },
    ]})).resolves.toEqual([]);
  });

  it('filters out invalid relationship types', async () => {
    const ss = new SessionStore(':memory:');
    const g = new GraphStore(ss.db);
    const extractor = new GraphEdgeExtractor({
      enabled: true,
      llm: async () => JSON.stringify([
        { from_id: '1', to_id: '2', relationship: 'contradicts' },
        { from_id: '1', to_id: '2', relationship: 'invalid-type' },
      ]),
      graph: g,
    });
    const result = await extractor.extract({
      observations: [
        { id: '1', title: 'T1', narrative: 'n1' },
        { id: '2', title: 'T2', narrative: 'n2' },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].relationship).toBe('contradicts');
  });

  it('rejects LLM edges with IDs outside the input set', async () => {
    const ss = new SessionStore(':memory:');
    const g = new GraphStore(ss.db);
    const extractor = new GraphEdgeExtractor({
      enabled: true,
      llm: async () => JSON.stringify([
        { from_id: '1', to_id: '999', relationship: 'contradicts' }, // 999 not in input
        { from_id: '1', to_id: '2', relationship: 'confirms' },      // valid
      ]),
      graph: g,
    });
    const result = await extractor.extract({
      observations: [
        { id: '1', title: 'T1', narrative: 'n1' },
        { id: '2', title: 'T2', narrative: 'n2' },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].relationship).toBe('confirms');
    const edges = ss.db.prepare("SELECT * FROM graph_edges WHERE relationship='contradicts'").all();
    expect(edges).toHaveLength(0);
  });
});
