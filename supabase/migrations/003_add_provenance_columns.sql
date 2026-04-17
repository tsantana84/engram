-- Add provenance and temporal retention columns to observations
ALTER TABLE observations ADD COLUMN IF NOT EXISTS git_branch TEXT;
ALTER TABLE observations ADD COLUMN IF NOT EXISTS invalidated_at BIGINT;
ALTER TABLE observations ADD COLUMN IF NOT EXISTS validation_status TEXT DEFAULT 'unvalidated';

CREATE INDEX IF NOT EXISTS idx_obs_validation ON observations(validation_status);
CREATE INDEX IF NOT EXISTS idx_obs_invalidated ON observations(invalidated_at);
