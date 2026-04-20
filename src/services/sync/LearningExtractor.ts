import type { ExtractedLearning } from './learning-types.js';

export interface SessionInput {
  sessionId: string;
  project: string;
  observations: Array<{ title: string; narrative: string | null; facts: string[] }>;
  summary: { request: string; investigated: string; learned: string; next_steps: string } | null;
}

export interface LearningExtractorConfig {
  enabled: boolean;
  llm: (prompt: string) => Promise<string>;
  maxLearningsPerSession: number;
}

// Prompt interpolates session fields (project/title/narrative/summary) directly.
// Upstream data is trusted (Claude tool outputs + agent-authored summary); no escaping.
function buildPrompt(input: SessionInput): string {
  const obsLines = input.observations
    .map(
      (o, i) =>
        `[${i + 1}] TITLE: ${o.title}\n    NARRATIVE: ${o.narrative ?? '(none)'}\n    FACTS: ${(o.facts ?? []).join(' | ')}`
    )
    .join('\n\n');

  const summaryBlock = input.summary
    ? `REQUEST: ${input.summary.request}\nINVESTIGATED: ${input.summary.investigated}\nLEARNED: ${input.summary.learned}\nNEXT STEPS: ${input.summary.next_steps}`
    : '(no summary)';

  return `You extract durable team learnings from a single coding session.
PROJECT: ${input.project}

SESSION OBSERVATIONS:
${obsLines || '(none)'}

SESSION SUMMARY:
${summaryBlock}

Extract only learnings that pass ALL THREE of these gates:
1. NON-OBVIOUS: an experienced engineer would not know this without hitting it themselves
2. ACTIONABLE: implies a concrete "when X, do/avoid Y" rule for future work
3. COSTLY TO FORGET: rediscovering it would waste >30 min

Reject anything that is:
- Discoverable by reading the code (structure, field names, file locations, table schemas)
- A one-time environment fix (missing env var, wrong path, local setup issue)
- A description of what was built (belongs in commit message, not learnings)
- A truism or generic best practice any engineer already knows

For each learning that passes, emit:
  claim:      concise actionable statement (one sentence, "when X, do/avoid Y" form preferred)
  evidence:   where/why this is known (short; cite file, error, or incident)
  scope:      one of 'project', 'area', 'global' (or free-form short label)
  confidence: 0.0–1.0 — how confident you are this generalizes and saves real time

Respond with a JSON array. No prose, no code fences. Empty session -> [].
Example:
[{"claim":"MigrationRunner and SessionStore both own schema versions — check both before adding a new version number","evidence":"version collision bug between MigrationRunner v26 and SessionStore v26","scope":"project","confidence":0.95}]`;
}

function clamp(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function parseArray(text: string): ExtractedLearning[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map<ExtractedLearning>((item) => ({
        claim: String(item.claim ?? '').trim(),
        evidence: item.evidence == null ? null : String(item.evidence),
        scope: item.scope == null ? null : String(item.scope),
        confidence: clamp(Number(item.confidence ?? 0)),
      }))
      .filter((l) => l.claim.length > 0);
  } catch {
    return [];
  }
}

export class LearningExtractor {
  private readonly config: LearningExtractorConfig;
  private readonly max: number;

  constructor(config: LearningExtractorConfig) {
    this.config = config;
    this.max = config.maxLearningsPerSession;
  }

  async extract(input: SessionInput): Promise<ExtractedLearning[]> {
    if (!this.config.enabled) return [];
    if (!input.observations.length && !input.summary) return [];
    const prompt = buildPrompt(input);
    try {
      const text = await this.config.llm(prompt);
      const parsed = parseArray(text);
      return parsed.slice(0, this.max);
    } catch (err) {
      console.error('[LearningExtractor] extract error:', err);
      return [];
    }
  }
}
