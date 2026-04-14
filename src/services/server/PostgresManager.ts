import pg from 'pg';
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

export class PostgresManager {
  private pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }

  async connect(): Promise<void> {
    const client = await this.pool.connect();
    client.release();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async query(text: string, params?: any[]): Promise<pg.QueryResult> {
    return this.pool.query(text, params);
  }

  async runMigrations(): Promise<void> {
    const sqlPath = join(__dirname, 'migrations', '001-initial-schema.sql');
    const sql = readFileSync(sqlPath, 'utf-8');
    await this.pool.query(sql);
  }

  async createAgent(name: string, apiKeyHash: string): Promise<AgentRecord> {
    const result = await this.pool.query(
      `INSERT INTO agents (name, api_key_hash) VALUES ($1, $2) RETURNING *`,
      [name, apiKeyHash]
    );
    return result.rows[0];
  }

  async getActiveAgents(): Promise<AgentRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM agents WHERE status = 'active' ORDER BY name`
    );
    return result.rows;
  }

  async getAgentByName(name: string): Promise<AgentRecord | null> {
    const result = await this.pool.query(
      `SELECT * FROM agents WHERE name = $1`,
      [name]
    );
    return result.rows[0] || null;
  }

  async revokeAgent(name: string): Promise<void> {
    await this.pool.query(
      `UPDATE agents SET status = 'revoked' WHERE name = $1`,
      [name]
    );
  }

  async insertObservation(obs: ObservationInsert): Promise<{ inserted: boolean }> {
    const result = await this.pool.query(
      `INSERT INTO observations (
        agent_id, local_id, content_hash, type, title, subtitle,
        facts, narrative, concepts, files_read, files_modified,
        project, created_at, created_at_epoch, prompt_number, model_used
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (agent_id, content_hash) DO NOTHING`,
      [
        obs.agent_id, obs.local_id, obs.content_hash, obs.type,
        obs.title, obs.subtitle,
        JSON.stringify(obs.facts), obs.narrative,
        JSON.stringify(obs.concepts),
        JSON.stringify(obs.files_read), JSON.stringify(obs.files_modified),
        obs.project, obs.created_at, obs.created_at_epoch,
        obs.prompt_number, obs.model_used,
      ]
    );
    return { inserted: (result.rowCount ?? 0) > 0 };
  }

  async insertSession(session: SessionInsert): Promise<{ inserted: boolean }> {
    const result = await this.pool.query(
      `INSERT INTO sessions (
        agent_id, local_session_id, content_session_id, project,
        platform_source, user_prompt, custom_title,
        started_at, started_at_epoch, completed_at, completed_at_epoch, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (agent_id, local_session_id) DO NOTHING`,
      [
        session.agent_id, session.local_session_id, session.content_session_id,
        session.project, session.platform_source, session.user_prompt,
        session.custom_title, session.started_at, session.started_at_epoch,
        session.completed_at, session.completed_at_epoch, session.status,
      ]
    );
    return { inserted: (result.rowCount ?? 0) > 0 };
  }

  async insertSummary(summary: SummaryInsert): Promise<{ inserted: boolean }> {
    const result = await this.pool.query(
      `INSERT INTO session_summaries (
        agent_id, local_summary_id, local_session_id, project,
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, created_at, created_at_epoch
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (agent_id, local_summary_id) DO NOTHING`,
      [
        summary.agent_id, summary.local_summary_id, summary.local_session_id,
        summary.project, summary.request, summary.investigated,
        summary.learned, summary.completed, summary.next_steps,
        summary.files_read, summary.files_edited, summary.notes,
        summary.created_at, summary.created_at_epoch,
      ]
    );
    return { inserted: (result.rowCount ?? 0) > 0 };
  }

  async searchObservations(query: string, options: SearchOptions = {}): Promise<ObservationSearchResult[]> {
    const limit = options.limit || 20;
    const offset = options.offset || 0;
    
    let whereClause = `WHERE 1=1`;
    const params: any[] = [];
    let paramIndex = 1;

    if (query) {
      whereClause += ` AND o.title ILIKE $${paramIndex} OR o.narrative ILIKE $${paramIndex}`;
      params.push(`%${query}%`);
      paramIndex++;
    }

    if (options.project) {
      whereClause += ` AND o.project = $${paramIndex}`;
      params.push(options.project);
      paramIndex++;
    }

    if (options.type) {
      whereClause += ` AND o.type = $${paramIndex}`;
      params.push(options.type);
      paramIndex++;
    }

    if (options.agent) {
      whereClause += ` AND a.name = $${paramIndex}`;
      params.push(options.agent);
      paramIndex++;
    }

    params.push(limit, offset);

    const result = await this.pool.query(
      `SELECT o.id, a.name as agent_name, 'team' as source,
              o.type, o.title, o.subtitle, o.facts, o.narrative,
              o.concepts, o.files_read, o.files_modified,
              o.project, o.created_at, o.created_at_epoch
       FROM observations o
       JOIN agents a ON o.agent_id = a.id
       ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    return result.rows.map((row: any) => ({
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
    const params: any[] = [];
    let paramIndex = 1;

    if (options.project) {
      whereClause += ` AND o.project = $${paramIndex}`;
      params.push(options.project);
      paramIndex++;
    }

    if (options.agent) {
      whereClause += ` AND a.name = $${paramIndex}`;
      params.push(options.agent);
      paramIndex++;
    }

    params.push(limit, offset);

    const result = await this.pool.query(
      `SELECT o.id, a.name as agent_name, 'team' as source,
              o.type, o.title, o.subtitle, o.facts, o.narrative,
              o.concepts, o.files_read, o.files_modified,
              o.project, o.created_at, o.created_at_epoch
       FROM observations o
       JOIN agents a ON o.agent_id = a.id
       ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    return result.rows;
  }

  async getAgentSyncStatus(agentId: string): Promise<{
    last_sync_at: string | null;
    observation_count: number;
    session_count: number;
  }> {
    const obsResult = await this.pool.query(
      `SELECT COUNT(*) as count, MAX(synced_at) as last_sync
       FROM observations WHERE agent_id = $1`,
      [agentId]
    );
    const sessResult = await this.pool.query(
      `SELECT COUNT(*) as count FROM sessions WHERE agent_id = $1`,
      [agentId]
    );

    return {
      last_sync_at: obsResult.rows[0]?.last_sync || null,
      observation_count: parseInt(obsResult.rows[0]?.count || '0'),
      session_count: parseInt(sessResult.rows[0]?.count || '0'),
    };
  }
}
