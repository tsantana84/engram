import { buildConflictPrompt, type SimilarItem, type ConflictDecision, type ConflictCheckResult } from './conflict-prompt.js';

export type { ConflictDecision, ConflictCheckResult };

export interface ServerConflictDetectorConfig {
  enabled: boolean;
  llm: (prompt: string) => Promise<string>;
  fetchSimilar: (item: { title: string; narrative?: string | null }) => Promise<SimilarItem[]>;
}

export class ServerConflictDetector {
  constructor(private cfg: ServerConflictDetectorConfig) {}

  async check(item: { title: string; narrative?: string | null }): Promise<ConflictCheckResult> {
    if (!this.cfg.enabled) return { decision: 'ADD' };
    try {
      const similar = await this.cfg.fetchSimilar(item);
      if (similar.length === 0) return { decision: 'ADD' };
      const prompt = buildConflictPrompt(item, similar);
      const text = await this.cfg.llm(prompt);
      const match = text.match(/\{[\s\S]*?\}/);
      if (!match) return { decision: 'ADD' };
      const parsed = JSON.parse(match[0]) as ConflictCheckResult;
      if (!['ADD', 'UPDATE', 'INVALIDATE', 'NOOP'].includes(parsed.decision)) {
        return { decision: 'ADD' };
      }
      return parsed;
    } catch {
      return { decision: 'ADD' };
    }
  }
}
