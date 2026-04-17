import { buildConflictPrompt, type SimilarItem } from './conflict-prompt.js';

export type ConflictDecision = 'ADD' | 'UPDATE' | 'INVALIDATE' | 'NOOP';

export interface ServerConflictDetectorConfig {
  enabled: boolean;
  llm: (prompt: string) => Promise<string>;
  fetchSimilar: (item: { title: string; narrative?: string | null }) => Promise<SimilarItem[]>;
}

export interface ConflictCheckResult {
  decision: ConflictDecision;
  targetId?: number | null;
  reason?: string;
}

export class ServerConflictDetector {
  constructor(private cfg: ServerConflictDetectorConfig) {}

  async check(item: { title: string; narrative?: string | null }): Promise<ConflictCheckResult> {
    if (!this.cfg.enabled || !this.cfg.llm) return { decision: 'ADD' };
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
