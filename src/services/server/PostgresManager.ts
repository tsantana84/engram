import postgres from 'postgres';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

let _instance: PostgresManager | null = null;
let _pendingInit: Promise<PostgresManager> | null = null;

export function getPostgresInstance(databaseUrl?: string): PostgresManager {
  if (_instance) return _instance;
  if (!databaseUrl) throw new Error('DATABASE_URL not set and no cached instance');
  _instance = new PostgresManager(databaseUrl);
  return _instance;
}

export async function initPostgres(databaseUrl: string): Promise<PostgresManager> {
  if (_instance) return _instance;
  if (_pendingInit) return _pendingInit;
  _pendingInit = (async () => {
    const mgr = new PostgresManager(databaseUrl);
    await mgr.connect();
    _instance = mgr;
    return mgr;
  })();
  return _pendingInit;
}

export function resetPostgres(): void {
  _instance = null;
  _pendingInit = null;
}

export class PostgresManager {
  private sql: ReturnType<typeof postgres>;
  private connected: boolean = false;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl);
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.sql`SELECT 1`;
    this.connected = true;
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    await this.sql.end();
    this.connected = false;
  }

  async query(text: string, params?: any[]): Promise<any> {
    return this.sql.unsafe(text, params);
  }

  async runMigrations(): Promise<void> {
    const sqlPath = join(__dirname, 'migrations', '001-initial-schema.sql');
    const sql = readFileSync(sqlPath, 'utf-8');
    await this.sql.unsafe(sql);
  }

  async createAgent(name: string, apiKeyHash: string): Promise<AgentRecord> {
    const [result] = await this.sql`
      INSERT INTO agents (name, api_key_hash) 
      VALUES (${name}, ${apiKeyHash}) 
      RETURNING *
    `;
    return result;
  }

  async getActiveAgents(): Promise<AgentRecord[]> {
    return await this.sql`
      SELECT * FROM agents WHERE status = 'active' ORDER BY name
    `;
  }

  async getAgentByName(name: string): Promise<AgentRecord | null> {
    const [result] = await this.sql`
      SELECT * FROM agents WHERE name = ${name}
    `;
    return result || null;
  }

  async revokeAgent(name: string): Promise<void> {
    await this.sql`
      UPDATE agents SET status = 'revoked' WHERE name = ${name}
    `;
  }

  async insertObservation(obs: ObservationInsert): Promise<{ inserted: boolean }> {
    const result = await this.sql`
      INSERT INTO observations (
        agent_id, local_id, content_hash, type, title, subtitle,
        facts, narrative, concepts, files_read, files_modified,
        project, created_at, created_at_epoch, prompt_number, model_used
      ) VALUES (
        ${obs.agent_id}, ${obs.local_id}, ${obs.content_hash}, ${obs.type},
        ${obs.title}, ${obs.subtitle},
        ${JSON.stringify(obs.facts)}, ${obs.narrative},
        ${JSON.stringify(obs.concepts)},
        ${JSON.stringify(obs.files_read)}, ${JSON.stringify(obs.files_modified)},
        ${obs.project}, ${obs.created_at}, ${obs.created_at_epoch},
        ${obs.prompt_number}, ${obs.model_used}
      )
    `;
    return { inserted: result.count > 0 };
  }

  async insertSession(session: SessionInsert): Promise<{ inserted: boolean }> {
    const result = await this.sql`
      INSERT INTO sessions (
        agent_id, local_session_id, content_session_id, project,
        platform_source, user_prompt, custom_title,
        started_at, started_at_epoch, completed_at, completed_at_epoch, status
      ) VALUES (
        ${session.agent_id}, ${session.local_session_id}, ${session.content_session_id},
        ${session.project}, ${session.platform_source}, ${session.user_prompt},
        ${session.custom_title}, ${session.started_at}, ${session.started_at_epoch},
        ${session.completed_at}, ${session.completed_at_epoch}, ${session.status}
      )
    `;
    return { inserted: result.count > 0 };
  }

  async insertSummary(summary: SummaryInsert): Promise<{ inserted: boolean }> {
    const result = await this.sql`
      INSERT INTO session_summaries (
        agent_id, local_summary_id, local_session_id, project,
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, created_at, created_at_epoch
      ) VALUES (
        ${summary.agent_id}, ${summary.local_summary_id}, ${summary.local_session_id},
        ${summary.project}, ${summary.request}, ${summary.investigated},
        ${summary.learned}, ${summary.completed}, ${summary.next_steps},
        ${summary.files_read}, ${summary.files_edited}, ${summary.notes},
        ${summary.created_at}, ${summary.created_at_epoch}
      )
    `;
    return { inserted: result.count > 0 };
  }

  async searchObservations(query: string, options: SearchOptions = {}): Promise<ObservationSearchResult[]> {
    const limit = options.limit || 20;
    const offset = options.offset || 0;

    let whereClause = `WHERE 1=1`;

    if (query) {
      whereClause += ` AND (o.title ILIKE ${'%' + query + '%'} OR o.narrative ILIKE ${'%' + query + '%'})`;
    }

    if (options.project) {
      whereClause += ` AND o.project = ${options.project}`;
    }

    if (options.type) {
      whereClause += ` AND o.type = ${options.type}`;
    }

    if (options.agent) {
      whereClause += ` AND a.name = ${options.agent}`;
    }

    const rows = await this.sql`
      SELECT o.id, a.name as agent_name, 'team' as source,
              o.type, o.title, o.subtitle, o.facts, o.narrative,
              o.concepts, o.files_read, o.files_modified,
              o.project, o.created_at, o.created_at_epoch
       FROM observations o
       JOIN agents a ON o.agent_id = a.id
       ${this.sql.unsafe(whereClause)}
       ORDER BY o.created_at DESC
       LIMIT ${limit} OFFSET ${offset}
    `;

    return rows.map((row: any) => ({
      ...row,
      facts: row.facts || [],
      concepts: row.concepts || [],
      files_read: row.files_read || [],
      files_modified: row.files_modified || [],
    }));
  }

  async getTimeline(options: SearchOptions = {}): Promise<ObservationSearchResult[]> {
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    let whereClause = 'WHERE 1=1';

    if (options.project) {
      whereClause += ` AND o.project = ${options.project}`;
    }

    if (options.agent) {
      whereClause += ` AND a.name = ${options.agent}`;
    }

    const rows = await this.sql`
      SELECT o.id, a.name as agent_name, 'team' as source,
              o.type, o.title, o.subtitle, o.facts, o.narrative,
              o.concepts, o.files_read, o.files_modified,
              o.project, o.created_at, o.created_at_epoch
       FROM observations o
       JOIN agents a ON o.agent_id = a.id
       ${this.sql.unsafe(whereClause)}
       ORDER BY o.created_at DESC
       LIMIT ${limit} OFFSET ${offset}
    `;

    return rows;
  }

  async getAgentSyncStatus(agentId: string): Promise<{
    last_sync_at: string | null;
    observation_count: number;
    session_count: number;
  }> {
    const [obsResult] = await this.sql`
      SELECT COUNT(*) as count, MAX(synced_at) as last_sync
       FROM observations WHERE agent_id = ${agentId}
    `;
    const [sessResult] = await this.sql`
      SELECT COUNT(*) as count FROM sessions WHERE agent_id = ${agentId}
    `;

    return {
      last_sync_at: obsResult?.last_sync || null,
      observation_count: parseInt(obsResult?.count || '0'),
      session_count: parseInt(sessResult?.count || '0'),
    };
  }
}
