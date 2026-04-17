import { SyncQueue, SyncQueueItem } from './SyncQueue.js';
import { SyncClient, SyncPushPayload, SyncObservationPayload, SyncSessionPayload, SyncSummaryPayload } from './SyncClient.js';
import { ConflictDetector } from './ConflictDetector.js';

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

  constructor(config: SyncWorkerConfig) {
    this.enabled = config.enabled;
    this.queue = config.queue;
    this.sessionStore = config.sessionStore;
    this.intervalMs = config.intervalMs;
    this.batchSize = config.batchSize;

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

  start(): void {
    if (!this.enabled) return;
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

    const pending = this.queue.getPending(this.batchSize);
    if (pending.length === 0) return;

    const payload = this.buildPayload(pending);
    payload.observations = await this.processConflicts(payload.observations);
    const ids = pending.map((item) => item.id);

    try {
      const response = await this.client.push(payload);
      this.queue.markSynced(ids);
    } catch (error: any) {
      const statusMatch = error.message?.match(/\((\d{3})\)/);
      const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;

      if (statusCode >= 400 && statusCode < 500) {
        this.queue.markFailedPermanently(ids);
      } else {
        this.queue.markFailed(ids);
      }
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
