-- The signals service runs a strategy for the users with automation switched on
-- and that strategy active (getStoredAutomatedUsers): a cross-user scan that
-- names the strategy as config->'strategies' @> {"<id>": {"active": true}}.
-- One containment index serves every strategy id; only switched-on
-- configurations are indexed. It replaces the enabled-only index, whose one
-- query this was.
CREATE INDEX IF NOT EXISTS algo_configuration_strategies_idx ON algo_configuration
  USING gin ((config -> 'strategies') jsonb_path_ops) WHERE config ->> 'enabled' = 'true';

DROP INDEX IF EXISTS algo_configuration_enabled_idx;
