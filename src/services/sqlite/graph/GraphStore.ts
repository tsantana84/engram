import type { Database } from 'bun:sqlite';
import { logger } from '../../../utils/logger.js';

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
