import { buildConflictPrompt } from '../../../api/lib/conflict-prompt.js';

export type ConflictDecision = 'ADD' | 'UPDATE' | 'INVALIDATE' | 'NOOP';

export interface SimilarObservation {
  id: number;
  title: string | null;
  narrative?: string | null;
  agent_name?: string;
  git_branch?: string | null;
}

export interface ConflictCheckResult {
  decision: ConflictDecision;
  targetId?: number;
  reason?: string;
}

export interface ConflictDetectorConfig {
  /** Fetch semantically similar observations — implemented by SyncClient.fetchSimilar() */
  fetchSimilar: (obs: { title: string; narrative?: string }) => Promise<SimilarObservation[]>;
  /**
   * Injected LLM function — routed through CLAUDE_MEM_PROVIDER (claude/gemini/openrouter).
   * Accepts a full prompt string, returns raw LLM text (JSON parsed internally).
   * Wired in worker-service.ts using the active agent's complete() method.
   * If not provided, conflict detection is disabled (all observations get ADD).
   */
  llm?: (prompt: string) => Promise<string>;
  /** Defaults to true. Set to false to disable without removing wiring. */
  enabled?: boolean;
}


export class ConflictDetector {
  private config: ConflictDetectorConfig;

  constructor(config: ConflictDetectorConfig) {
    this.config = config;
  }

  async check(obs: { title: string; narrative?: string }): Promise<ConflictCheckResult> {
    if (this.config.enabled === false || !this.config.llm) {
      return { decision: 'ADD' };
    }

    try {
      const similar = await this.config.fetchSimilar(obs);
      if (similar.length === 0) return { decision: 'ADD' };

      const prompt = buildConflictPrompt(obs, similar);
      const text = await this.config.llm(prompt);

      // Extract first JSON object from response (LLM may wrap in prose)
      const match = text.match(/\{[\s\S]*?\}/);
      if (!match) return { decision: 'ADD' };

      const parsed = JSON.parse(match[0]) as ConflictCheckResult;
      // Validate decision is one of the known values
      if (!['ADD', 'UPDATE', 'INVALIDATE', 'NOOP'].includes(parsed.decision)) {
        return { decision: 'ADD' };
      }
      return parsed;
    } catch {
      return { decision: 'ADD' };
    }
  }
}
