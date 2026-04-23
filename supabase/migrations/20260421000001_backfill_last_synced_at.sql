UPDATE agents
SET last_synced_at = sub.max_synced
FROM (
  SELECT agent_id, MAX(synced_at) AS max_synced
  FROM observations
  GROUP BY agent_id
) sub
WHERE agents.id = sub.agent_id
  AND agents.last_synced_at IS NULL;
