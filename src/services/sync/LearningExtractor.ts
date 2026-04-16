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

Extract 0 to N learnings useful to other agents/engineers on this codebase.
A learning is: a durable, generalizable, testable claim — NOT a play-by-play of what happened.
Skip transient details, commit noise, environment-specific paths.

For each learning, emit:
  claim:      concise statement (one sentence)
  evidence:   where/why this is known (short; cite file or fact)
  scope:      one of 'project', 'area', 'global' (or free-form short label)
  confidence: 0.0–1.0 — how confident you are this generalizes beyond this session

Respond with a JSON array. No prose, no code fences. Empty session -> [].
Example:
[{"claim":"Worker readiness depends on initialization completing","evidence":"worker-service.ts readiness path","scope":"area","confidence":0.9}]`;
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
    } catch {
      return [];
    }
  }
}
