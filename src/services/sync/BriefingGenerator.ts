export interface BriefingInput {
  memorySessionId: string;
  project: string;
  transcriptTail: string;         // last ~6000 chars of transcript
  recentFiles: string[];
  openTodos: string[];
  recentDecisions: string[];
  recentErrors: string[];
}

export interface BriefingGeneratorConfig {
  llm?: (prompt: string) => Promise<string>;
}

// Token budget: 500 tokens ≈ 2000 chars. Template gets 300 tokens (~1200 chars), LLM gets 150 tokens (~600 chars).
const TEMPLATE_BUDGET = 1200;
const LLM_BUDGET = 600;

function truncateList(items: string[], budget: number): string {
  const lines: string[] = [];
  let remaining = budget;
  for (const item of items) {
    const line = `- ${item}`;
    if (remaining - line.length - 1 < 0) break;
    lines.push(line);
    remaining -= line.length + 1;
  }
  return lines.join('\n');
}

function buildTemplate(input: BriefingInput): string {
  // Budget allocation: files=300, todos=300, decisions=300, errors=300 chars each
  const itemBudget = Math.floor(TEMPLATE_BUDGET / 4);
  const sections: string[] = ['## Context Recovery Briefing'];

  if (input.recentFiles.length > 0) {
    const content = truncateList(input.recentFiles, itemBudget - 20);
    sections.push(`**Recent files:**\n${content}`);
  }
  if (input.openTodos.length > 0) {
    const content = truncateList(input.openTodos, itemBudget - 20);
    sections.push(`**Open todos:**\n${content}`);
  }
  if (input.recentDecisions.length > 0) {
    const content = truncateList(input.recentDecisions, itemBudget - 20);
    sections.push(`**Recent decisions:**\n${content}`);
  }
  if (input.recentErrors.length > 0) {
    const content = truncateList(input.recentErrors, itemBudget - 20);
    sections.push(`**Recent errors:**\n${content}`);
  }

  return sections.join('\n\n');
}

function buildLlmPrompt(input: BriefingInput): string {
  const tail = input.transcriptTail.slice(-4000);
  return `Summarize the active task from this conversation tail in 1-2 sentences (max 120 tokens). Be specific about what was being worked on and what the immediate next step is.

Conversation tail:
${tail}

Active task summary:`;
}

export class BriefingGenerator {
  private llm?: (prompt: string) => Promise<string>;

  constructor(config: BriefingGeneratorConfig) {
    this.llm = config.llm;
  }

  async generate(input: BriefingInput): Promise<{ text: string; usedLlm: boolean }> {
    const template = buildTemplate(input);

    if (!this.llm) {
      return { text: template.slice(0, TEMPLATE_BUDGET), usedLlm: false };
    }

    let llmSummary = '';
    try {
      const raw = await this.llm(buildLlmPrompt(input));
      llmSummary = raw.trim().slice(0, LLM_BUDGET);
    } catch {
      // LLM failure: return template only, signal fallback
      return { text: template.slice(0, TEMPLATE_BUDGET), usedLlm: false };
    }

    const combined = `${template}\n\n**Active task:**\n${llmSummary}`;
    return { text: combined.slice(0, TEMPLATE_BUDGET + LLM_BUDGET), usedLlm: true };
  }
}
