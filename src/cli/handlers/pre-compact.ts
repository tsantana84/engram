/**
 * PreCompact Handler - Amnesia Recovery Protocol
 *
 * Fires before Claude Code compacts the context window.
 * Generates a briefing snapshot so the agent can recover context after compaction.
 *
 * CRITICAL: This handler MUST always return exitCode 0.
 * Compaction must never be blocked under any circumstances.
 */

import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import { ensureWorkerRunning, workerHttpRequest } from '../../shared/worker-utils.js';
import { isProjectExcluded } from '../../utils/project-filter.js';
import { logger } from '../../utils/logger.js';
import { HOOK_EXIT_CODES } from '../../shared/hook-constants.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH } from '../../shared/paths.js';

const BRIEFING_TIMEOUT_MS = 8000;

export const preCompactHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    // Always exit 0 — never block compaction
    const safe: HookResult = { exitCode: HOOK_EXIT_CODES.SUCCESS };

    try {
      const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
      if (settings.CLAUDE_MEM_AMNESIA_RECOVERY_ENABLED !== 'true') return safe;

      const cwd = input.cwd ?? '';
      if (isProjectExcluded(cwd, settings.CLAUDE_MEM_EXCLUDED_PROJECTS)) return safe;

      const workerRunning = await ensureWorkerRunning();
      if (!workerRunning) return safe;

      // Read transcript tail from hook payload (Claude Code provides transcript path)
      const transcriptPath = (input.payload as any)?.transcript_path as string | undefined;
      let transcriptTail = '';
      if (transcriptPath) {
        try {
          const { readFileSync } = await import('fs');
          const content = readFileSync(transcriptPath, 'utf-8');
          transcriptTail = content.slice(-6000);
        } catch { /* transcript unreadable — proceed with template-only */ }
      }

      const body = {
        memorySessionId: input.sessionId ?? '',
        project: cwd,
        transcriptTail,
        recentFiles: [],
        openTodos: [],
        recentDecisions: [],
        recentErrors: [],
      };

      await workerHttpRequest('/api/briefings/generate', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        timeoutMs: BRIEFING_TIMEOUT_MS,
      });
      logger.debug('HOOK', 'amnesia recovery: briefing generated', { project: cwd });
    } catch (err) {
      // Never let errors surface — compaction must not be blocked
      logger.debug('HOOK', 'amnesia recovery: pre-compact handler error (suppressed)', { err: String(err) });
    }

    return safe;
  },
};
