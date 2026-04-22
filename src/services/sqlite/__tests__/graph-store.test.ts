import { describe, it, expect, beforeEach } from 'bun:test';
import { SessionStore } from '../SessionStore';

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
