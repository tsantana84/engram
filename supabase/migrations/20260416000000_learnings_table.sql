-- Migration 002: Learnings table for learning-extraction pipeline

-- Learnings table
CREATE TABLE IF NOT EXISTS learnings (
  id               bigserial PRIMARY KEY,
  claim            text NOT NULL,
  evidence         text,
  scope            text,
  confidence       numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  project          text,
  source_agent_id  uuid REFERENCES agents(id) ON DELETE SET NULL,
  source_session   text NOT NULL,
  content_hash     text NOT NULL,
  invalidated      boolean NOT NULL DEFAULT false,
  invalidated_by   bigint REFERENCES learnings(id),
  extracted_at     timestamptz NOT NULL DEFAULT now(),
  reviewed_at      timestamptz,
  reviewed_by      text,
  edit_diff        jsonb,
  rejection_reason text,
  UNIQUE (source_session, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_learnings_status  ON learnings (status);
CREATE INDEX IF NOT EXISTS idx_learnings_project ON learnings (project);
CREATE INDEX IF NOT EXISTS idx_learnings_hash    ON learnings (content_hash);
CREATE INDEX IF NOT EXISTS idx_learnings_agent   ON learnings (source_agent_id);

-- schema_versions value: verify next free number before applying.
INSERT INTO schema_versions (version) VALUES (2) ON CONFLICT DO NOTHING;
