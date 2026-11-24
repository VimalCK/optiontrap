-- Per-strategy automation (shared/automation.js): the account's Algo Trading
-- switch and general rules over every strategy, and each strategy its own
-- execution modes, horizons, entry and exit rules.
--
-- Reshape each stored configuration once (a reshaped one has generalRules):
--   * every strategy gets a copy of the account's former mode (as its
--     execution switches), horizons, entry and exit rules, so nothing a user
--     set is lost;
--   * Maximum open positions and Max loss per day move to generalRules. Max
--     loss per day was both an entry and an exit rule; the exit one is kept
--     when it was active (it also refused entries), else the entry one;
--   * the trade kinds go: every strategy trades what it selects.
UPDATE algo_configuration c
SET config = jsonb_build_object(
      'enabled', COALESCE((c.config ->> 'enabled')::boolean, false),
      'generalRules', jsonb_strip_nulls(jsonb_build_object(
        'max-open-positions', c.config #> '{entryRules,max-open-positions}',
        'max-daily-loss', CASE
          WHEN (c.config #>> '{exitRules,max-daily-loss,active}')::boolean THEN c.config #> '{exitRules,max-daily-loss}'
          ELSE COALESCE(c.config #> '{entryRules,max-daily-loss}', c.config #> '{exitRules,max-daily-loss}')
        END
      )),
      'strategies', COALESCE((
        SELECT jsonb_object_agg(strategy.key, strategy.value || jsonb_build_object(
          'execution', jsonb_build_object(
            'Paper', COALESCE(c.config ->> 'mode', 'Paper') = 'Paper',
            'Live', c.config ->> 'mode' = 'Live'
          ),
          'horizons', COALESCE(c.config -> 'horizons', '{}'::jsonb),
          'entryRules', COALESCE(c.config -> 'entryRules', '{}'::jsonb) - 'max-open-positions' - 'max-daily-loss',
          'exitRules', COALESCE(c.config -> 'exitRules', '{}'::jsonb) - 'max-daily-loss'
        ))
        -- A configuration saved before any strategy was switched on keeps its
        -- settings in the one strategy there was, inactive.
        FROM jsonb_each(COALESCE(NULLIF(c.config -> 'strategies', '{}'::jsonb),
          '{"option-analyzer-setups": {"active": false, "params": {}}}'::jsonb)) AS strategy
      ), '{}'::jsonb)
    ),
    updated_at = now()
WHERE NOT c.config ? 'generalRules';

-- The strategy an automated position belongs to, and the strategy whose
-- position an order opens or closes. Two strategies in the same instrument
-- keep their own position (a leg each), so each exits only its own lots; the
-- Positions page shows them combined, as the broker nets them. Manual ones
-- have none.
ALTER TABLE positions ADD COLUMN IF NOT EXISTS strategy_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS strategy_id TEXT;

UPDATE positions p
SET strategy_id = t.strategy_id
FROM algo_trades t
WHERE t.position_id = p.id AND p.source = 'Auto' AND p.strategy_id IS NULL AND t.strategy_id IS NOT NULL;

UPDATE orders o
SET strategy_id = t.strategy_id
FROM algo_trades t
WHERE t.id = o.algo_trade_id AND o.source = 'Auto' AND o.strategy_id IS NULL AND t.strategy_id IS NOT NULL;

UPDATE orders o
SET strategy_id = p.strategy_id
FROM positions p
WHERE p.id = o.position_id AND o.closes_position AND o.strategy_id IS NULL AND p.strategy_id IS NOT NULL;

-- An automated position or entry order names its strategy, a manual one
-- none. A closing order names its position's, whoever exits it (the session
-- square-off exits manual positions too).
-- NOT VALID: checked on every new or changed row, without failing on a
-- legacy automated row whose trade record is gone.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'positions_strategy_check') THEN
    ALTER TABLE positions ADD CONSTRAINT positions_strategy_check
      CHECK ((source = 'Auto') = (strategy_id IS NOT NULL)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_strategy_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_strategy_check
      CHECK (closes_position OR (source = 'Auto') = (strategy_id IS NOT NULL)) NOT VALID;
  END IF;
END $$;

-- The trade monitor and the entry rules read a user's open automated
-- positions and waiting automated orders, all strategies at once (the general
-- rules) or one strategy's (its own rules, and the merge of its trade into its
-- own position): (user_id, strategy_id) serves both, replacing the user-only
-- indexes.
CREATE INDEX IF NOT EXISTS positions_open_auto_strategy_idx ON positions (user_id, strategy_id) WHERE source = 'Auto' AND NOT exited;
DROP INDEX IF EXISTS positions_open_auto_idx;
CREATE INDEX IF NOT EXISTS orders_open_auto_strategy_idx ON orders (user_id, strategy_id) WHERE status = 'Open' AND source = 'Auto';
DROP INDEX IF EXISTS orders_open_auto_idx;
