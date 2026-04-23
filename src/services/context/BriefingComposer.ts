import { logger } from '../../utils/logger.js';
import type { SessionStore } from '../sqlite/SessionStore.js';

const MAX_CHARS = 2000; // ~500 tokens

interface SessionSummaryRow { next_steps: string | null; completed: string | null; }
interface CorrectionRow { tried: string; wrong_because: string; fix: string; trigger_context: string; }
interface DecisionRow { title: string | null; narrative: string | null; }

function queryLastSummary(db: SessionStore, project: string): SessionSummaryRow | null {
  try {
    return db.db.prepare(`
      SELECT next_steps, completed FROM session_summaries
      WHERE project = ? ORDER BY created_at_epoch DESC LIMIT 1
    `).get(project) as SessionSummaryRow | null;
  } catch { return null; }
}

function queryRecentCorrections(db: SessionStore, project: string): CorrectionRow[] {
  try {
    return db.db.prepare(`
      SELECT tried, wrong_because, fix, trigger_context FROM corrections
      WHERE project = ? AND trigger_context != ''
      ORDER BY created_at DESC LIMIT 3
    `).all(project) as CorrectionRow[];
  } catch { return []; }
}

function queryRecentDecisions(db: SessionStore, project: string): DecisionRow[] {
  try {
    return db.db.prepare(`
      SELECT title, narrative FROM observations
      WHERE project = ? AND type = 'decision'
      ORDER BY created_at_epoch DESC LIMIT 5
    `).all(project) as DecisionRow[];
  } catch { return []; }
}

function buildTemplate(
  summary: SessionSummaryRow | null,
  corrections: CorrectionRow[],
  decisions: DecisionRow[]
): string {
  const sections: string[] = ['## AGENT BRIEFING'];

  if (summary?.next_steps || summary?.completed) {
    const parts: string[] = [];
    if (summary.completed) parts.push(`Completed: ${summary.completed}`);
    if (summary.next_steps) parts.push(`Next: ${summary.next_steps}`);
    sections.push(`**Last session:** ${parts.join('. ')}`);
  }

  if (corrections.length > 0) {
    const lines = corrections.map(c =>
      `- Tried: ${c.tried}. Wrong because: ${c.wrong_because}. Fix: ${c.fix}. [Context: ${c.trigger_context}]`
    );
    sections.push(`**Watch out:**\n${lines.join('\n')}`);
  }

  if (decisions.length > 0) {
    const lines = decisions.map(d => `- ${d.title ?? d.narrative ?? ''}`.slice(0, 120));
    sections.push(`**Decisions made:**\n${lines.join('\n')}`);
  }

  if (sections.length === 1) return ''; // only header — nothing to show
  sections.push('---');
  return sections.join('\n\n');
}

export function buildSessionBriefing(db: SessionStore, project: string): string {
  const summary = queryLastSummary(db, project);
  const corrections = queryRecentCorrections(db, project);
  const decisions = queryRecentDecisions(db, project);

  const text = buildTemplate(summary, corrections, decisions);
  return text.slice(0, MAX_CHARS);
}

const LLM_PROMPT = (userPrompt: string, sources: string) =>
  `You are writing a briefing for an AI coding agent about to start work.

The agent's task: "${userPrompt}"

Available context from past sessions:
${sources}

Write a briefing of ≤400 tokens. Rules:
- Use imperative voice ("Watch out for X", "You decided Y", "Next step is Z")
- Include ONLY what's relevant to the agent's task above
- Omit irrelevant sections entirely
- Keep it tight — the agent will read every word
- Do NOT include a header line

Output only the briefing text, no preamble.`;

export async function buildPromptBriefing(
  db: SessionStore,
  project: string,
  userPrompt: string,
  llm: (prompt: string) => Promise<string>
): Promise<string> {
  const staticFallback = buildSessionBriefing(db, project);
  if (!staticFallback) return '';

  try {
    const raw = await llm(LLM_PROMPT(userPrompt, staticFallback));
    const result = '## AGENT BRIEFING\n\n' + raw.trim() + '\n\n---';
    return result.slice(0, MAX_CHARS);
  } catch (err) {
    logger.debug('BRIEFING', 'LLM composition failed, using static fallback', {}, err as Error);
    return staticFallback;
  }
}
