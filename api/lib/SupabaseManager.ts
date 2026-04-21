import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { LearningPayload, LearningTargetStatus, LearningRecord } from '../../src/services/sync/learning-types.js';

export interface AgentRecord {
  id: string;
  name: string;
  api_key_hash: string;
  status: string;
  created_at: string;
}

export interface ObservationInsert {
  agent_id: string;
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

export interface SessionInsert {
  agent_id: string;
  local_session_id: number;
  content_session_id: string;
  project: string;
  platform_source: string;
  user_prompt: string | null;
  custom_title: string | null;
  started_at: string;
  started_at_epoch: number;
  completed_at: string | null;
  completed_at_epoch: number | null;
  status: string;
}

export interface SummaryInsert {
  agent_id: string;
  local_summary_id: number;
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

export interface SearchOptions {
  limit?: number;
  offset?: number;
  project?: string;
  type?: string;
  agent?: string;
}

export interface ObservationSearchResult {
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
}

let _instance: SupabaseManager | null = null;
let _pendingInit: Promise<SupabaseManager> | null = null;

export function getSupabaseInstance(url?: string, anonKey?: string): SupabaseManager {
  if (_instance) return _instance;
  if (!url || !anonKey) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required');
  _instance = new SupabaseManager(url.trim(), anonKey.trim());
  return _instance;
}

export async function initSupabase(url: string, anonKey: string): Promise<SupabaseManager> {
  if (_instance) return _instance;
  if (_pendingInit) return _pendingInit;
  _pendingInit = (async () => {
    const mgr = new SupabaseManager(url.trim(), anonKey.trim());
    _instance = mgr;
    return mgr;
  })();
  return _pendingInit;
}

export function resetSupabase(): void {
  _instance = null;
  _pendingInit = null;
}

export class SupabaseManager {
  private supabase: SupabaseClient;
  private url: string;
  private anonKey: string;

  constructor(urlOrClient: string | SupabaseClient, anonKey?: string) {
    if (typeof urlOrClient === 'string') {
      if (!anonKey) throw new Error('anonKey required when url is provided');
      this.url = urlOrClient;
      this.anonKey = anonKey;
      this.supabase = createClient(urlOrClient, anonKey);
    } else {
      this.url = '';
      this.anonKey = '';
      this.supabase = urlOrClient;
    }
  }

  async createAgent(name: string, apiKeyHash: string): Promise<AgentRecord> {
    const { data, error } = await this.supabase
      .from('agents')
      .insert({ name, api_key_hash: apiKeyHash })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async getActiveAgents(): Promise<AgentRecord[]> {
    const { data, error } = await this.supabase
      .from('agents')
      .select('*')
      .eq('status', 'active')
      .order('name');
    if (error) throw error;
    return data || [];
  }

  async getAgentByName(name: string): Promise<AgentRecord | null> {
    const { data, error } = await this.supabase
      .from('agents')
      .select('*')
      .eq('name', name)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  }

  async revokeAgent(name: string): Promise<void> {
    const { error } = await this.supabase
      .from('agents')
      .update({ status: 'revoked' })
      .eq('name', name);
    if (error) throw error;
  }

  async insertObservation(obs: ObservationInsert): Promise<{ inserted: boolean }> {
    const { error } = await this.supabase
      .from('observations')
      .insert({
        agent_id: obs.agent_id,
        local_id: obs.local_id,
        content_hash: obs.content_hash,
        type: obs.type,
        title: obs.title,
        subtitle: obs.subtitle,
        facts: obs.facts,
        narrative: obs.narrative,
        concepts: obs.concepts,
        files_read: obs.files_read,
        files_modified: obs.files_modified,
        project: obs.project,
        created_at: obs.created_at,
        created_at_epoch: obs.created_at_epoch,
        prompt_number: obs.prompt_number,
        model_used: obs.model_used,
      });
    if (error) {
      if (error.code === '23505') return { inserted: false };
      throw error;
    }
    return { inserted: true };
  }

  async insertSession(session: SessionInsert): Promise<{ inserted: boolean }> {
    const { error } = await this.supabase
      .from('sessions')
      .insert({
        agent_id: session.agent_id,
        local_session_id: session.local_session_id,
        content_session_id: session.content_session_id,
        project: session.project,
        platform_source: session.platform_source,
        user_prompt: session.user_prompt,
        custom_title: session.custom_title,
        started_at: session.started_at,
        started_at_epoch: session.started_at_epoch,
        completed_at: session.completed_at,
        completed_at_epoch: session.completed_at_epoch,
        status: session.status,
      });
    if (error) {
      if (error.code === '23505') return { inserted: false };
      throw error;
    }
    return { inserted: true };
  }

  async insertSummary(summary: SummaryInsert): Promise<{ inserted: boolean }> {
    const { error } = await this.supabase
      .from('session_summaries')
      .insert({
        agent_id: summary.agent_id,
        local_summary_id: summary.local_summary_id,
        local_session_id: summary.local_session_id,
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
    if (error) {
      if (error.code === '23505') return { inserted: false };
      throw error;
    }
    return { inserted: true };
  }

  async searchObservations(query: string, options: SearchOptions = {}): Promise<ObservationSearchResult[]> {
    const limit = options.limit || 20;
    const offset = options.offset || 0;

    let q = this.supabase
      .from('observations')
      .select(`
        id, type, title, subtitle, facts, narrative, concepts,
        files_read, files_modified, project, created_at, created_at_epoch,
        agents(name)
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (options.project) q = q.eq('project', options.project);
    if (options.type) q = q.eq('type', options.type);
    if (query) q = q.or(`title.ilike.%${query}%,narrative.ilike.%${query}%`);
    q = q.is('invalidated_at', null);

    const { data, error } = await q;
    if (error) throw error;

    return (data || []).map((row: any) => ({
      id: row.id,
      agent_name: row.agents?.name || '',
      source: 'team' as const,
      type: row.type,
      title: row.title,
      subtitle: row.subtitle,
      facts: row.facts || [],
      narrative: row.narrative,
      concepts: row.concepts || [],
      files_read: row.files_read || [],
      files_modified: row.files_modified || [],
      project: row.project,
      created_at: row.created_at,
      created_at_epoch: row.created_at_epoch,
    }));
  }

  async getTimeline(options: SearchOptions = {}): Promise<ObservationSearchResult[]> {
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    let q = this.supabase
      .from('observations')
      .select(`
        id, type, title, subtitle, facts, narrative, concepts,
        files_read, files_modified, project, created_at, created_at_epoch,
        agents(name)
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (options.project) q = q.eq('project', options.project);

    const { data, error } = await q;
    if (error) throw error;

    return (data || []).map((row: any) => ({
      id: row.id,
      agent_name: row.agents?.name || '',
      source: 'team' as const,
      type: row.type,
      title: row.title,
      subtitle: row.subtitle,
      facts: row.facts || [],
      narrative: row.narrative,
      concepts: row.concepts || [],
      files_read: row.files_read || [],
      files_modified: row.files_modified || [],
      project: row.project,
      created_at: row.created_at,
      created_at_epoch: row.created_at_epoch,
    }));
  }

  async getAgentSyncStatus(agentId: string): Promise<{
    last_sync_at: string | null;
    observation_count: number;
    session_count: number;
  }> {
    const [{ count: obsCount }, { count: sessCount }] = await Promise.all([
      this.supabase.from('observations').select('id', { count: 'exact', head: true }).eq('agent_id', agentId),
      this.supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('agent_id', agentId),
    ]);

    const { data: lastSyncData } = await this.supabase
      .from('observations')
      .select('synced_at')
      .eq('agent_id', agentId)
      .order('synced_at', { ascending: false })
      .limit(1);

    return {
      last_sync_at: lastSyncData?.[0]?.synced_at || null,
      observation_count: obsCount || 0,
      session_count: sessCount || 0,
    };
  }

  async invalidateObservations(localIds: number[], agentId: string): Promise<void> {
    if (localIds.length === 0) return;
    const { error } = await this.supabase
      .from('observations')
      .update({
        invalidated_at: Date.now(),
        validation_status: 'invalidated',
      })
      .in('local_id', localIds)
      .eq('agent_id', agentId);

    if (error) throw error;
  }

  async insertLearning(
    payload: LearningPayload & { source_agent_id: string },
    targetStatus: LearningTargetStatus
  ): Promise<{ id?: number; action: 'inserted' | 'dedupe_noop' }> {
    const row = {
      claim: payload.claim,
      evidence: payload.evidence,
      scope: payload.scope,
      confidence: payload.confidence,
      status: targetStatus,
      project: payload.project,
      source_agent_id: payload.source_agent_id,
      source_session: payload.source_session,
      content_hash: payload.content_hash,
    };
    const { data, error } = await this.supabase
      .from('learnings')
      .upsert(row, { onConflict: 'source_session,content_hash', ignoreDuplicates: true })
      .select()
      .single();

    if (error) {
      if ((error as any).code === 'PGRST116') return { action: 'dedupe_noop' };
      throw error;
    }
    if (!data) return { action: 'dedupe_noop' };
    return { id: data.id, action: 'inserted' };
  }

  async invalidateLearning(id: number, replacedBy: number): Promise<void> {
    const { error } = await this.supabase
      .from('learnings')
      .update({ invalidated: true, invalidated_by: replacedBy })
      .eq('id', id);
    if (error) throw error;
  }

  async fetchSimilarLearnings(claim: string, limit = 5): Promise<Array<{
    id: number; title: string | null; narrative: string | null;
  }>> {
    const { data, error } = await this.supabase
      .from('learnings')
      .select('id, claim, evidence')
      .eq('status', 'approved')
      .eq('invalidated', false)
      .ilike('claim', `%${claim.slice(0, 64)}%`)
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map((r: any) => ({ id: r.id, title: r.claim, narrative: r.evidence ?? null }));
  }

  async listLearnings(opts: {
    status?: 'pending' | 'approved' | 'rejected';
    project?: string;
    limit: number;
    offset: number;
  }): Promise<LearningRecord[]> {
    let q = this.supabase.from('learnings').select('*');
    if (opts.status) q = q.eq('status', opts.status);
    if (opts.project) q = q.eq('project', opts.project);
    const { data, error } = await q
      .order('extracted_at', { ascending: false })
      .range(opts.offset, opts.offset + opts.limit - 1);
    if (error) throw error;
    return (data ?? []) as LearningRecord[];
  }

  async countLearnings(project?: string): Promise<{ pending: number; approved: number; rejected: number }> {
    const statuses = ['pending', 'approved', 'rejected'] as const;
    const counts = await Promise.all(statuses.map(async status => {
      let q = this.supabase.from('learnings').select('*', { count: 'exact', head: true }).eq('status', status);
      if (project) q = q.eq('project', project);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    }));
    return { pending: counts[0], approved: counts[1], rejected: counts[2] };
  }

  async searchLearnings(query: string, project?: string, limit = 10): Promise<LearningRecord[]> {
    let q = this.supabase
      .from('learnings')
      .select('*')
      .eq('status', 'approved')
      .eq('invalidated', false)
      .ilike('claim', `%${query.slice(0, 64)}%`)
      .limit(limit);
    if (project) q = q.eq('project', project);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as LearningRecord[];
  }
  async getLearning(id: number): Promise<LearningRecord | null> {
    const { data, error } = await this.supabase
      .from('learnings')
      .select('*')
      .eq('id', id)
      .single();
    if (error && (error as any).code !== 'PGRST116') throw error;
    return (data as LearningRecord) ?? null;
  }

  async getAgentActivity(): Promise<Array<{
    id: string;
    name: string;
    lastSeenAt: string | null;
    observationCount: number;
    sessionCount: number;
    learningCount: number;
  }>> {
    const { data: agents, error } = await this.supabase
      .from('agents')
      .select('id, name');
    if (error) throw error;

    return Promise.all((agents ?? []).map(async (agent: { id: string; name: string }) => {
      const [obsResult, learningsResult] = await Promise.all([
        this.supabase
          .from('observations')
          .select('created_at, session_id')
          .eq('agent_id', agent.id),
        this.supabase
          .from('learnings')
          .select('id', { count: 'exact', head: true })
          .eq('source_agent_id', agent.id),
      ]);

      const observations = obsResult.data ?? [];
      const lastSeenAt = observations.length > 0
        ? observations.reduce((max: string, o: { created_at: string }) => o.created_at > max ? o.created_at : max, observations[0].created_at)
        : null;
      const sessionCount = new Set(observations.map((o: { session_id: string }) => o.session_id)).size;

      return {
        id: agent.id,
        name: agent.name,
        lastSeenAt,
        observationCount: observations.length,
        sessionCount,
        learningCount: learningsResult.count ?? 0,
      };
    }));
  }

  async reviewLearning(
    id: number,
    patch: {
      status: 'approved' | 'rejected';
      reviewed_by: string;
      edit_diff?: Record<string, unknown> | null;
      edited?: Partial<Pick<LearningPayload, 'claim' | 'evidence' | 'scope'>>;
      rejection_reason?: string;
    }
  ): Promise<LearningRecord> {
    const update: Record<string, unknown> = {
      ...(patch.edited ?? {}),
      status: patch.status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: patch.reviewed_by,
    };
    if (patch.edit_diff !== undefined) update.edit_diff = patch.edit_diff;
    if (patch.rejection_reason !== undefined) update.rejection_reason = patch.rejection_reason;

    const { data, error } = await this.supabase
      .from('learnings')
      .update(update)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as LearningRecord;
  }

  async getSyncHealth(): Promise<Array<{ agentId: string; lastSyncAt: string | null }>> {
    const { data, error } = await this.supabase
      .from('observations')
      .select('agent_id, synced_at')
      .not('synced_at', 'is', null);
    if (error) throw error;

    const byAgent = new Map<string, string>();
    for (const row of data ?? []) {
      const current = byAgent.get(row.agent_id);
      if (!current || row.synced_at > current) {
        byAgent.set(row.agent_id, row.synced_at);
      }
    }

    return Array.from(byAgent.entries()).map(([agentId, lastSyncAt]) => ({ agentId, lastSyncAt }));
  }

  async getLearningQuality(): Promise<{
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    approvalRate: number | null;
    confidenceDistribution: { high: number; medium: number; low: number };
  }> {
    const { data, error } = await this.supabase
      .from('learnings')
      .select('status, confidence');
    if (error) throw error;

    const rows = data ?? [];
    const counts = { pending: 0, approved: 0, rejected: 0 };
    const dist = { high: 0, medium: 0, low: 0 };

    for (const row of rows) {
      counts[row.status as keyof typeof counts]++;
      const c = row.confidence ?? 0;
      if (c >= 0.9) dist.high++;
      else if (c >= 0.7) dist.medium++;
      else dist.low++;
    }

    const reviewed = counts.approved + counts.rejected;
    return {
      total: rows.length,
      ...counts,
      approvalRate: reviewed > 0 ? counts.approved / reviewed : null,
      confidenceDistribution: dist,
    };
  }
}
