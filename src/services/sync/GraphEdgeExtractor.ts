import type { GraphStore } from '../sqlite/graph/GraphStore.js';

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

const VALID_RELATIONSHIPS = ['contradicts', 'depends-on', 'supersedes', 'confirms'] as const;

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
        (VALID_RELATIONSHIPS as readonly string[]).includes(e.relationship)
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
