/**
 * ContextBuilder - Main orchestrator for context generation
 *
 * Coordinates all context generation components to build the final output.
 * This is the primary entry point for context generation.
 */

import path from 'path';
import { homedir } from 'os';
import { unlinkSync } from 'fs';
import { SessionStore } from '../sqlite/SessionStore.js';
import { logger } from '../../utils/logger.js';
import { getProjectName } from '../../utils/project-name.js';

import type { ContextInput, ContextConfig, Observation, SessionSummary } from './types.js';
import { loadContextConfig } from './ContextConfigLoader.js';
import { calculateTokenEconomics } from './TokenCalculator.js';
import {
  queryObservations,
  queryObservationsMulti,
  querySummaries,
  querySummariesMulti,
  getPriorSessionMessages,
  prepareSummariesForTimeline,
  buildTimeline,
  getFullObservationIds,
} from './ObservationCompiler.js';
import { renderHeader } from './sections/HeaderRenderer.js';
import { renderTimeline } from './sections/TimelineRenderer.js';
import { shouldShowSummary, renderSummaryFields } from './sections/SummaryRenderer.js';
import { renderPreviouslySection, renderFooter } from './sections/FooterRenderer.js';
import { renderAgentEmptyState } from './formatters/AgentFormatter.js';
import { renderHumanEmptyState } from './formatters/HumanFormatter.js';

// Corrections prewarm helpers

interface CorrectionPrewarm {
  tried: string;
  wrong_because: string;
  fix: string;
  trigger_context: string;
}

function queryCorrections(db: SessionStore, project: string): CorrectionPrewarm[] {
  try {
    return db.db.prepare(`
      SELECT tried, wrong_because, fix, trigger_context
      FROM corrections
      WHERE project = ? AND trigger_context != ''
      ORDER BY weight_multiplier DESC, created_at DESC
      LIMIT 10
    `).all(project) as CorrectionPrewarm[];
  } catch {
    return [];
  }
}

function scoreCorrections(corrections: CorrectionPrewarm[], goal: string): CorrectionPrewarm[] {
  if (!goal || corrections.length === 0) return corrections.slice(0, 3);
  const goalWords = new Set(goal.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  return corrections
    .map(c => ({
      correction: c,
      score: c.trigger_context.toLowerCase().split(/\W+/).filter(w => goalWords.has(w)).length,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(x => x.correction);
}

function renderCorrectionsBlock(corrections: CorrectionPrewarm[]): string {
  if (corrections.length === 0) return '';
  const lines = corrections.map(c =>
    `- Tried: ${c.tried}. Wrong because: ${c.wrong_because}. Fix: ${c.fix}.\n  [Context: ${c.trigger_context}]`
  );
  return `\n## PAST CORRECTIONS (high priority)\n${lines.join('\n')}\n`;
}

// Version marker path for native module error handling
const VERSION_MARKER_PATH = path.join(
  homedir(),
  '.claude',
  'plugins',
  'marketplaces',
  'thedotmack',
  'plugin',
  '.install-version'
);

/**
 * Initialize database connection with error handling
 */
function initializeDatabase(): SessionStore | null {
  try {
    return new SessionStore();
  } catch (error: any) {
    if (error.code === 'ERR_DLOPEN_FAILED') {
      try {
        unlinkSync(VERSION_MARKER_PATH);
      } catch (unlinkError) {
        logger.debug('SYSTEM', 'Marker file cleanup failed (may not exist)', {}, unlinkError as Error);
      }
      logger.error('SYSTEM', 'Native module rebuild needed - restart Claude Code to auto-fix');
      return null;
    }
    throw error;
  }
}

/**
 * Render empty state when no data exists
 */
function renderEmptyState(project: string, forHuman: boolean): string {
  return forHuman ? renderHumanEmptyState(project) : renderAgentEmptyState(project);
}

/**
 * Build context output from loaded data
 */
function buildContextOutput(
  project: string,
  observations: Observation[],
  summaries: SessionSummary[],
  config: ContextConfig,
  cwd: string,
  sessionId: string | undefined,
  forHuman: boolean
): string {
  const output: string[] = [];

  // Calculate token economics
  const economics = calculateTokenEconomics(observations);

  // Render header section
  output.push(...renderHeader(project, economics, config, forHuman));

  // Prepare timeline data
  const displaySummaries = summaries.slice(0, config.sessionCount);
  const summariesForTimeline = prepareSummariesForTimeline(displaySummaries, summaries);
  const timeline = buildTimeline(observations, summariesForTimeline);
  const fullObservationIds = getFullObservationIds(observations, config.fullObservationCount);

  // Render timeline
  output.push(...renderTimeline(timeline, fullObservationIds, config, cwd, forHuman));

  // Render most recent summary if applicable
  const mostRecentSummary = summaries[0];
  const mostRecentObservation = observations[0];

  if (shouldShowSummary(config, mostRecentSummary, mostRecentObservation)) {
    output.push(...renderSummaryFields(mostRecentSummary, forHuman));
  }

  // Render previously section (prior assistant message)
  const priorMessages = getPriorSessionMessages(observations, config, sessionId, cwd);
  output.push(...renderPreviouslySection(priorMessages, forHuman));

  // Render footer
  output.push(...renderFooter(economics, config, forHuman));

  return output.join('\n').trimEnd();
}

/**
 * Generate context for a project
 *
 * Main entry point for context generation. Orchestrates loading config,
 * querying data, and rendering the final context string.
 */
export async function generateContext(
  input?: ContextInput,
  forHuman: boolean = false
): Promise<string> {
  const config = loadContextConfig();
  const cwd = input?.cwd ?? process.cwd();
  const project = getProjectName(cwd);
  const platformSource = input?.platform_source;

  // Use provided projects array (for worktree support) or fall back to single project
  const projects = input?.projects || [project];

  // Full mode: fetch all observations but keep normal rendering (level 1 summaries)
  if (input?.full) {
    config.totalObservationCount = 999999;
    config.sessionCount = 999999;
  }

  // Initialize database
  const db = initializeDatabase();
  if (!db) {
    return '';
  }

  try {
    // Query data for all projects (supports worktree: parent + worktree combined)
    const observations = projects.length > 1
      ? queryObservationsMulti(db, projects, config, platformSource)
      : queryObservations(db, project, config, platformSource);
    const summaries = projects.length > 1
      ? querySummariesMulti(db, projects, config, platformSource)
      : querySummaries(db, project, config, platformSource);

    // Handle empty state
    if (observations.length === 0 && summaries.length === 0) {
      return renderEmptyState(project, forHuman);
    }

    // Corrections prewarm: query project-scoped corrections, score against session goal
    const allCorrections = queryCorrections(db, project);
    const correctionGoal = observations[0]?.title ?? '';
    const prewarmCorrections = scoreCorrections(allCorrections, correctionGoal);
    const correctionsBlock = renderCorrectionsBlock(prewarmCorrections);

    // Build and return context
    const output = buildContextOutput(
      project,
      observations,
      summaries,
      config,
      cwd,
      input?.session_id,
      forHuman
    );

    return correctionsBlock + output;
  } finally {
    db.close();
  }
}
