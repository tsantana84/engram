import { SyncQueue, SyncQueueItem } from './SyncQueue.js';
import { SyncClient, SyncPushPayload, SyncObservationPayload, SyncSessionPayload, SyncSummaryPayload } from './SyncClient.js';
import { ConflictDetector } from './ConflictDetector.js';
import { LearningExtractor, type SessionInput } from './LearningExtractor.js';
import type { LearningPayload, LearningTargetStatus } from './learning-types.js';
import { logger } from '../../utils/logger.js';

function sha256(s: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(s);
  return hasher.digest('hex');
}

export interface SyncWorkerConfig {
  enabled: boolean;
  queue: SyncQueue;
  sessionStore: any;
  serverUrl: string;
  apiKey: string;
  agentName: string;
  intervalMs: number;
  timeoutMs: number;
  maxRetries: number;
  batchSize: number;
  /**
   * Optional LLM function for conflict detection.
   * Injected from worker-service.ts using the active provider (CLAUDE_MEM_PROVIDER).
   * If not provided, conflict detection is skipped (all observations pass as ADD).
   */
  llm?: (prompt: string) => Promise<string>;
  /**
   * Optional learning extractor. When provided along with `extractionEnabled: true`,
   * the worker runs per-session extraction during tick() and enqueues approved/pending
   * learnings instead of pushing raw observations.
   */
  extractor?: LearningExtractor;
  /** Learnings with confidence >= threshold are auto-approved. Default 0.8. */
  confidenceThreshold?: number;
  /** When false, SyncWorker behaves like the legacy observation-only path. Default false. */
  extractionEnabled?: boolean;
  /** Maximum extraction attempts before a session is marked permanently_failed. Default 3. */
  extractionMaxRetries?: number;
}

export class SyncWorker {
  private enabled: boolean;
  private queue: SyncQueue;
  private sessionStore: any;
  private client: SyncClient;
  private detector: ConflictDetector;
  private intervalMs: number;
  private batchSize: number;
  private paused: boolean = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private extractor: LearningExtractor | undefined;
  private confidenceThreshold: number;
  private extractionEnabled: boolean;
  private extractionMaxRetries: number;
  private lastExtractionAt: string | null = null;
  private lastExtractionStats: {
    observationsProcessed: number;
    extracted: number;
    skipped: number;
    failed: number;
  } | null = null;

  constructor(config: SyncWorkerConfig) {
    this.enabled = config.enabled;
    this.queue = config.queue;
    this.sessionStore = config.sessionStore;
    this.intervalMs = config.intervalMs;
    this.batchSize = config.batchSize;
    this.extractor = config.extractor;
    this.confidenceThreshold = config.confidenceThreshold ?? 0.8;
    this.extractionEnabled = config.extractionEnabled ?? false;
    this.extractionMaxRetries = config.extractionMaxRetries ?? 3;

    this.client = new SyncClient({
      serverUrl: config.serverUrl,
      apiKey: config.apiKey,
      agentName: config.agentName,
      timeoutMs: config.timeoutMs,
    });

    this.detector = new ConflictDetector({
      fetchSimilar: (obs) => this.client.fetchSimilar(obs.title ?? ''),
      llm: config.llm,
      enabled: true,
    });
  }

  getExtractionStats(): {
    enabled: boolean;
    threshold: number;
    lastRunAt: string | null;
    lastRunStats: typeof this.lastExtractionStats;
  } | null {
    if (!this.extractionEnabled) return null;
    return {
      enabled: true,
      threshold: this.confidenceThreshold,
      lastRunAt: this.lastExtractionAt,
      lastRunStats: this.lastExtractionStats,
    };
  }

  start(): void {
    if (!this.enabled) return;
    if (this.extractionEnabled) {
      this.sessionStore.resetStaleExtractionRows();
    }
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  async tick(): Promise<void> {
    if (!this.enabled || this.paused) return;

    // 1. Extract pending/retryable sessions into queued learnings.
    if (this.extractionEnabled && this.extractor) {
      const sessions = this.sessionStore.getPendingExtractionSessions(5);
      for (const s of sessions) {
        await this.extractSessionLearnings(s.id);
      }
    }

    // 2. Drain the sync queue.
    const pending = this.queue.getPending(this.batchSize);
    if (pending.length === 0) return;

    const learningItems = pending.filter((p) => p.entity_type === 'learning');
    const legacyItems = pending.filter((p) => p.entity_type !== 'learning');

    const approvedItems = learningItems.filter((p) => p.target_status === 'approved');
    const pendingItems = learningItems.filter((p) => p.target_status === 'pending');

    for (const [group, status] of [
      [approvedItems, 'approved'] as const,
      [pendingItems, 'pending'] as const,
    ]) {
      if (group.length === 0) continue;
      try {
        await this.client.pushLearnings(
          group.map((g) => g.payload!).filter(Boolean),
          status
        );
        this.queue.markSynced(group.map((g) => g.id));
      } catch (err: any) {
        this.handlePushError(err, group.map((g) => g.id));
      }
    }

    // Legacy observation/session/summary path — kept behind the flag so the
    // rollout can fall back without code changes.
    if (!this.extractionEnabled && legacyItems.length > 0) {
      const payload = this.buildPayload(legacyItems);
      payload.observations = await this.processConflicts(payload.observations);
      const ids = legacyItems.map((i) => i.id);
      try {
        await this.client.push(payload);
        this.queue.markSynced(ids);
      } catch (err: any) {
        this.handlePushError(err, ids);
      }
    } else if (legacyItems.length > 0) {
      // Feature flag on, but legacy items snuck in (e.g., existing queue rows
      // from before the flag flipped). Drop them to avoid double-push.
      this.queue.markSynced(legacyItems.map((i) => i.id));
    }
  }

  /**
   * Extract durable learnings from one completed session and enqueue them.
   * No-ops when the feature flag is off or no extractor was injected.
   *
   * Confidence threshold controls auto-approval: payloads at or above the
   * threshold enter the queue with target_status='approved'; below it, with
   * target_status='pending' for manual review.
   */
  async extractSessionLearnings(sessionDbId: number): Promise<void> {
    if (!this.extractionEnabled || !this.extractor) return;
    const session = this.sessionStore.getSessionById(sessionDbId);
    if (!session) return;
    this.sessionStore.markExtractionInProgress(sessionDbId);
    try {
      const input = this.buildSessionInput(session);
      const { appendFileSync } = await import('fs');
      const { homedir } = await import('os');
      const { join } = await import('path');
      const dbg = join(homedir(), '.engram', 'extraction-debug.log');
      appendFileSync(dbg, `[${new Date().toISOString()}] session=${sessionDbId} obs=${input.observations.length} hasSummary=${!!input.summary}\n`);
      const learnings = await this.extractor.extract(input);
      appendFileSync(dbg, `[${new Date().toISOString()}] session=${sessionDbId} learnings=${learnings.length}\n`);
      const threshold = this.confidenceThreshold;
      let extracted = 0;
      let skipped = 0;
      for (const l of learnings) {
        const payload: LearningPayload = {
          ...l,
          project: session.project,
          source_session: session.memory_session_id ?? String(session.id),
          content_hash: sha256(`${l.claim}\n${l.scope ?? ''}`),
        };
        const target: LearningTargetStatus =
          l.confidence >= threshold ? 'approved' : 'pending';
        this.queue.enqueueLearning(payload, target);
        if (l.confidence >= threshold) {
          extracted++;
        } else {
          skipped++;
        }
      }
      this.lastExtractionAt = new Date().toISOString();
      this.lastExtractionStats = {
        observationsProcessed: input.observations.length,
        extracted,
        skipped,
        failed: 0,
      };
      this.sessionStore.markExtractionDone(sessionDbId);
    } catch (err) {
      this.lastExtractionAt = new Date().toISOString();
      this.lastExtractionStats = {
        observationsProcessed: 0,
        extracted: 0,
        skipped: 0,
        failed: 1,
      };
      this.sessionStore.markExtractionFailed(sessionDbId, this.extractionMaxRetries);
    }
  }

  private buildSessionInput(session: {
    id: number;
    project: string;
    memory_session_id: string | null;
  }): SessionInput {
    const obsRows = this.sessionStore.getObservationsForSession(
      session.memory_session_id ?? ''
    );
    const summaryRow = session.memory_session_id
      ? this.sessionStore.getSummaryForSession(session.memory_session_id)
      : null;
    return {
      sessionId: String(session.id),
      project: session.project,
      observations: obsRows.map((o: any) => ({
        title: o.title ?? '',
        narrative: o.narrative ?? null,
        facts: this.parseJsonArray(o.facts),
      })),
      summary: summaryRow
        ? {
            request: summaryRow.request ?? '',
            investigated: summaryRow.investigated ?? '',
            learned: summaryRow.learned ?? '',
            next_steps: summaryRow.next_steps ?? '',
          }
        : null,
    };
  }

  private handlePushError(error: any, ids: number[]): void {
    const statusMatch = error?.message?.match(/\((\d{3})\)/);
    const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;
    if (statusCode >= 400 && statusCode < 500) {
      this.queue.markFailedPermanently(ids);
    } else {
      this.queue.markFailed(ids, error?.message ?? 'unknown error');
    }
  }

  private buildPayload(items: SyncQueueItem[]): SyncPushPayload {
    const observations: SyncObservationPayload[] = [];
    const sessions: SyncSessionPayload[] = [];
    const summaries: SyncSummaryPayload[] = [];

    for (const item of items) {
      switch (item.entity_type) {
        case 'observation': {
          const obs = this.sessionStore.getObservationById(item.entity_id);
          if (obs) {
            observations.push({
              local_id: obs.id,
              content_hash: obs.content_hash || '',
              type: obs.type,
              title: obs.title,
              subtitle: obs.subtitle,
              facts: this.parseJsonArray(obs.facts),
              narrative: obs.narrative,
              concepts: this.parseJsonArray(obs.concepts),
              files_read: this.parseJsonArray(obs.files_read),
              files_modified: this.parseJsonArray(obs.files_modified),
              project: obs.project,
              created_at: obs.created_at,
              created_at_epoch: obs.created_at_epoch,
              prompt_number: obs.prompt_number,
              model_used: obs.model_used,
            });
          }
          break;
        }
        case 'session': {
          const session = this.sessionStore.getSessionById(item.entity_id);
          if (session) {
            sessions.push({
              local_id: session.id,
              content_session_id: session.content_session_id,
              project: session.project,
              platform_source: session.platform_source || 'claude',
              user_prompt: session.user_prompt,
              custom_title: session.custom_title,
              started_at: session.started_at,
              started_at_epoch: session.started_at_epoch,
              completed_at: session.completed_at,
              completed_at_epoch: session.completed_at_epoch,
              status: session.status,
            });
          }
          break;
        }
        case 'summary': {
          const summary = this.sessionStore.getSummaryById(item.entity_id);
          if (summary) {
            summaries.push({
              local_id: summary.id,
              local_session_id: summary.memory_session_id ? parseInt(summary.memory_session_id) : 0,
              project: summary.project,
              request: summary.request,
              investigated: summary.investigated,
              learned: summary.learned,
              completed: summary.completed,
              next_steps: summary.next_steps,
              files_read: summary.files_read,
              files_edited: summary.files_edited,
              notes: summary.notes,
              created_at: summary.created_at,
              created_at_epoch: summary.created_at_epoch,
            });
          }
          break;
        }
      }
    }

    return { observations, sessions, summaries };
  }

  private async processConflicts(observations: SyncObservationPayload[]): Promise<SyncObservationPayload[]> {
    const toInvalidate: number[] = [];
    const filtered: SyncObservationPayload[] = [];

    for (const obs of observations) {
      if (!obs.title) {
        filtered.push(obs);
        continue;
      }

      const result = await this.detector.check({
        title: obs.title,
        narrative: obs.narrative ?? undefined,
      });

      if (result.decision === 'NOOP') continue; // drop duplicate

      if ((result.decision === 'INVALIDATE' || result.decision === 'UPDATE') && result.targetId) {
        toInvalidate.push(result.targetId);
      }

      filtered.push(obs);
    }

    if (toInvalidate.length > 0) {
      await this.client.pushInvalidations(toInvalidate);
    }

    return filtered;
  }

  private parseJsonArray(value: string | string[] | null): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
      return JSON.parse(value);
    } catch {
      return [value];
    }
  }
}
