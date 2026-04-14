-- Migration 001: Initial schema for multi-agent sync server

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Agents table
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL UNIQUE,
  api_key_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);

-- Observations table (mirrors local SQLite with agent attribution)
CREATE TABLE IF NOT EXISTS observations (
  id SERIAL PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES agents(id),
  local_id INTEGER NOT NULL,
  content_hash VARCHAR(128) NOT NULL,
  type VARCHAR(50) NOT NULL,
  title TEXT,
  subtitle TEXT,
  facts JSONB DEFAULT '[]',
  narrative TEXT,
  concepts JSONB DEFAULT '[]',
  files_read JSONB DEFAULT '[]',
  files_modified JSONB DEFAULT '[]',
  project VARCHAR(500) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  created_at_epoch BIGINT NOT NULL,
  prompt_number INTEGER,
  model_used VARCHAR(255),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agent_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_observations_agent ON observations(agent_id);
CREATE INDEX IF NOT EXISTS idx_observations_project ON observations(project);
CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_content_hash ON observations(content_hash);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES agents(id),
  local_session_id INTEGER NOT NULL,
  content_session_id VARCHAR(255) NOT NULL,
  project VARCHAR(500) NOT NULL,
  platform_source VARCHAR(50) DEFAULT 'claude',
  user_prompt TEXT,
  custom_title TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  started_at_epoch BIGINT NOT NULL,
  completed_at TIMESTAMPTZ,
  completed_at_epoch BIGINT,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agent_id, local_session_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);

-- Session summaries table
CREATE TABLE IF NOT EXISTS session_summaries (
  id SERIAL PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES agents(id),
  local_summary_id INTEGER NOT NULL,
  local_session_id INTEGER NOT NULL,
  project VARCHAR(500) NOT NULL,
  request TEXT,
  investigated TEXT,
  learned TEXT,
  completed TEXT,
  next_steps TEXT,
  files_read TEXT,
  files_edited TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  created_at_epoch BIGINT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agent_id, local_summary_id)
);

CREATE INDEX IF NOT EXISTS idx_summaries_agent ON session_summaries(agent_id);

-- Schema versions tracking
CREATE TABLE IF NOT EXISTS schema_versions (
  id SERIAL PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_versions (version) VALUES (1) ON CONFLICT DO NOTHING;
