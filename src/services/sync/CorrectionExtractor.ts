import { logger } from '../../utils/logger.js';

export interface CorrectionExtractorConfig {
  enabled: boolean;
  llm: (prompt: string) => Promise<string>;
  model: string;
  maxTokens: number;
}

export interface CorrectionRecord {
  tried: string;
  wrong_because: string;
  fix: string;
  trigger_context: string;
  session_id?: string;
  project?: string;
}

const EXTRACTION_PROMPT = (context: string) => `Extract a correction from this exchange. Return null if no clear mistake was made by the assistant.

${context}

Return JSON or the literal null:
{"tried": "what the assistant attempted", "wrong_because": "why it was wrong", "fix": "the correct approach", "trigger_context": "3-6 word phrase for when this mistake recurs"}

Rules:
- trigger_context must be non-empty (e.g. "deleting files safely", "writing commit messages")
- Return null if no assistant mistake is evident
- Return null if trigger_context would be empty`;

export class CorrectionExtractor {
  private config: CorrectionExtractorConfig;

  constructor(config: CorrectionExtractorConfig) {
    this.config = config;
  }

  async extract(context: string): Promise<CorrectionRecord | null> {
    if (!this.config.enabled) return null;

    try {
      const raw = await this.config.llm(EXTRACTION_PROMPT(context));
      const trimmed = raw.trim();
      if (trimmed === 'null' || trimmed === '') return null;

      const parsed = JSON.parse(trimmed) as Partial<CorrectionRecord>;
      if (!parsed.tried || !parsed.wrong_because || !parsed.fix || !parsed.trigger_context) return null;
      if (!parsed.trigger_context.trim()) return null;

      return {
        tried: parsed.tried,
        wrong_because: parsed.wrong_because,
        fix: parsed.fix,
        trigger_context: parsed.trigger_context,
      };
    } catch (err) {
      logger.debug('CORRECTION', 'Extraction failed', {}, err as Error);
      return null;
    }
  }
}
