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

function buildPrompt(obs: { title: string; narrative?: string }, similar: SimilarObservation[]): string {
  const similarText = similar.map((s, i) =>
    `[${i + 1}] ID:${s.id} | Agent:${s.agent_name ?? 'unknown'} | Branch:${s.git_branch ?? 'unknown'}\n    TITLE: ${s.title ?? ''}\n    NARRATIVE: ${s.narrative ?? '(none)'}`
  ).join('\n\n');

  return `You are a memory conflict resolver for a shared AI coding assistant knowledge base.

A new observation is about to be stored:
TITLE: ${obs.title}
NARRATIVE: ${obs.narrative ?? '(none)'}

Most semantically similar existing observations:
${similarText}

Decide what to do. Choose ONE:
- ADD: New information, no conflict. Store it.
- UPDATE: Supersedes an existing one. Store new, invalidate old (provide targetId).
- INVALIDATE: Contradicts an existing one that appears wrong. Invalidate old, add new (provide targetId).
- NOOP: Duplicate or adds no value. Skip.

Respond ONLY with JSON: {"decision": "ADD"|"UPDATE"|"INVALIDATE"|"NOOP", "targetId": <number or null>, "reason": "<brief>"}`;
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

      const prompt = buildPrompt(obs, similar);
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
