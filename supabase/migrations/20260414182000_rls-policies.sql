-- Enable RLS and create permissive policies for the sync server
-- Since we authenticate via our own API key (not Supabase auth),
-- we disable RLS policy checks for these tables.

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_versions ENABLE ROW LEVEL SECURITY;

-- Agents: allow all operations via anon key
CREATE POLICY "Allow all for agents" ON agents FOR ALL USING (true) WITH CHECK (true);

-- Observations: allow all operations via anon key
CREATE POLICY "Allow all for observations" ON observations FOR ALL USING (true) WITH CHECK (true);

-- Sessions: allow all operations via anon key
CREATE POLICY "Allow all for sessions" ON sessions FOR ALL USING (true) WITH CHECK (true);

-- Session summaries: allow all operations via anon key
CREATE POLICY "Allow all for session_summaries" ON session_summaries FOR ALL USING (true) WITH CHECK (true);

-- Schema versions: allow read via anon key
CREATE POLICY "Allow read for schema_versions" ON schema_versions FOR SELECT USING (true);
