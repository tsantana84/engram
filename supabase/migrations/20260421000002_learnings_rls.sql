-- Add RLS policy for learnings table (was missing from initial schema)
-- Learnings table was added in 20260416000000_learnings_table.sql without RLS,
-- causing all learning push attempts to fail silently via the anon key.

ALTER TABLE learnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for learnings" ON learnings FOR ALL USING (true) WITH CHECK (true);
