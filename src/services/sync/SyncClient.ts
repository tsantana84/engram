import type { SimilarObservation } from './ConflictDetector.js';
import type { LearningPayload, LearningTargetStatus, LearningPushResponse } from './learning-types.js';

export interface SyncClientConfig {
  serverUrl: string;
  apiKey: string;
  agentName: string;
  timeoutMs: number;
}

export interface SyncObservationPayload {
  local_id: number;
  content_hash: string;
  type: string;
  title: string | null;
  subtitle: string | null;
  facts: string[];
  narrative: string | null;
  concepts: string[];
  files_read: string[];
  files_modified: string[];
  project: string;
  created_at: string;
  created_at_epoch: number;
  prompt_number: number | null;
  model_used: string | null;
}

export interface SyncSessionPayload {
  local_id: number;
  content_session_id: string;
  project: string;
  platform_source: string;
  user_prompt: string;
  custom_title: string | null;
  started_at: string;
  started_at_epoch: number;
  completed_at: string | null;
  completed_at_epoch: number | null;
  status: string;
}

export interface SyncSummaryPayload {
  local_id: number;
  local_session_id: number;
  project: string;
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
  files_read: string | null;
  files_edited: string | null;
  notes: string | null;
  created_at: string;
  created_at_epoch: number;
}

export interface SyncPushPayload {
  observations: SyncObservationPayload[];
  sessions: SyncSessionPayload[];
  summaries: SyncSummaryPayload[];
}

export interface SyncPushResponse {
  accepted: number;
  duplicates: number;
  errors: string[];
}

export interface SyncStatusResponse {
  agent_name: string;
  last_sync_at: string | null;
  observation_count: number;
  session_count: number;
}

export interface TeamSearchResult {
  observations: Array<{
    id: number;
    agent_name: string;
    source: 'team';
    type: string;
    title: string | null;
    subtitle: string | null;
    facts: string[];
    narrative: string | null;
    concepts: string[];
    files_read: string[];
    files_modified: string[];
    project: string;
    created_at: string;
    created_at_epoch: number;
  }>;
}

export class SyncClient {
  private serverUrl: string;
  private apiKey: string;
  private agentName: string;
  private timeoutMs: number;

  constructor(config: SyncClientConfig) {
    this.serverUrl = config.serverUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.agentName = config.agentName;
    this.timeoutMs = config.timeoutMs;
  }

  private buildUrl(path: string): string {
    return `${this.serverUrl}${path}`;
  }

  private buildHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async push(payload: SyncPushPayload): Promise<SyncPushResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.buildUrl('/api/sync/push'), {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Sync push failed (${response.status}): ${text}`);
      }

      return await response.json() as SyncPushResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getStatus(): Promise<SyncStatusResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.buildUrl('/api/sync/status'), {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Sync status failed (${response.status})`);
      }

      return await response.json() as SyncStatusResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  async searchTeam(query: string, params: Record<string, string> = {}): Promise<TeamSearchResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = new URL(this.buildUrl('/api/search'));
      url.searchParams.set('q', query);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Team search failed (${response.status})`);
      }

      return await response.json() as TeamSearchResult;
    } finally {
      clearTimeout(timeout);
    }
  }

  async timelineTeam(params: Record<string, string> = {}): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = new URL(this.buildUrl('/api/timeline'));
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Team timeline failed (${response.status})`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async fetchSimilar(title: string, limit = 5): Promise<SimilarObservation[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = new URL(this.buildUrl('/api/search'));
      url.searchParams.set('q', title);
      url.searchParams.set('limit', String(limit));
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: controller.signal,
      });
      if (!response.ok) return [];
      const data = await response.json() as { results?: SimilarObservation[] };
      return data.results ?? [];
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  async pushInvalidations(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      await fetch(this.buildUrl('/api/sync/invalidate'), {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ ids }),
        signal: controller.signal,
      });
    } catch {
      // Silent failure — invalidation is best-effort
    } finally {
      clearTimeout(timeout);
    }
  }

  async pushLearnings(learnings: LearningPayload[], target_status: LearningTargetStatus): Promise<LearningPushResponse> {
    const response = await fetch(this.buildUrl('/api/sync/learnings'), {
      method: 'POST',
      headers: { ...this.buildHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ learnings, target_status }),
    });
    if (!response.ok) {
      throw new Error(`pushLearnings failed (${response.status}): ${await response.text()}`);
    }
    return response.json() as Promise<LearningPushResponse>;
  }
}
