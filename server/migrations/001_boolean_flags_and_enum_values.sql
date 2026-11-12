-- Three changes, each safe to run again and on a database with data:
--
-- 1. Yes/no columns stored as INTEGER 0/1 become BOOLEAN, like
--    sessions.is_admin: users.is_admin, subscription_plans.is_active and
--    positions.exited (0 → false, anything else → true).
-- 2. Trade horizon changes from SMALLINT 1/2 to text on positions, orders and
--    algo_trades (1 → 'Intraday', 2 → 'Positional').
-- 3. Every stored enum value becomes its member's name in shared/tradeEnums.js
--    and shared/appEnums.js, so the database holds exactly what the code names
--    ('open' → 'Open' for OrderStatus.Open, 'stock-option' → 'StockOption'):
--    the columns, their CHECK constraints and defaults, the partial indexes
--    whose predicate names a value, and the automation configuration's JSON.
--    Values already in Kite's form (BUY/SELL, CE/PE/FUT/EQ, NSE/NFO …) and the
--    OI trade setup signals (stored as BUY/SELL and Open/Profit/Loss) already
--    match and don't change.
--
-- A migration is a fixed record, so it names the old and new values as text;
-- the app's SQL names them through sqlEnum (server/sql.js).
--
-- Partial indexes whose predicate names a column or a value are dropped first
-- and created again at the end with the new predicate, so Postgres uses them
-- for the queries that now state the new values.

-- ── 1. Yes/no flags ──

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'is_admin' AND data_type = 'integer'
  ) THEN
    DROP INDEX IF EXISTS users_non_admin_updated_idx;
    ALTER TABLE users
      ALTER COLUMN is_admin DROP DEFAULT,
      ALTER COLUMN is_admin TYPE BOOLEAN USING is_admin <> 0,
      ALTER COLUMN is_admin SET DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'subscription_plans' AND column_name = 'is_active' AND data_type = 'integer'
  ) THEN
    ALTER TABLE subscription_plans
      ALTER COLUMN is_active DROP DEFAULT,
      ALTER COLUMN is_active TYPE BOOLEAN USING is_active <> 0,
      ALTER COLUMN is_active SET DEFAULT true;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'positions' AND column_name = 'exited' AND data_type = 'integer'
  ) THEN
    DROP INDEX IF EXISTS positions_open_idx;
    DROP INDEX IF EXISTS positions_closed_idx;
    DROP INDEX IF EXISTS positions_open_auto_idx;
    DROP INDEX IF EXISTS positions_open_intraday_idx;
    ALTER TABLE positions
      ALTER COLUMN exited DROP DEFAULT,
      ALTER COLUMN exited TYPE BOOLEAN USING exited <> 0,
      ALTER COLUMN exited SET DEFAULT false;
  END IF;
END $$;

-- ── 2. Horizon as text ──
-- The old CHECK (horizon IN (1, 2)) goes before the type change; the new one
-- is added with the other enum checks below. Serves the merge lookup
-- (findOpenPositionToMerge) and the square-off scan
-- (getOpenIntradayPositionsBefore, positions_open_intraday_idx).

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['positions', 'orders', 'algo_trades'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = tbl AND column_name = 'horizon' AND data_type = 'smallint'
    ) THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', tbl, tbl || '_horizon_check');
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN horizon TYPE TEXT USING CASE horizon WHEN 1 THEN %L WHEN 2 THEN %L END',
        tbl, 'Intraday', 'Positional');
    END IF;
  END LOOP;
END $$;

-- ── 3. Enum values as their member names ──

-- Rewrite `col` of `tbl` from each old value to the new one at the same
-- position; rows holding any other value are left as they are.
CREATE OR REPLACE FUNCTION pg_temp.rename_values(tbl TEXT, col TEXT, old_values TEXT[], new_values TEXT[])
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE format('UPDATE %I SET %I = ($2)[array_position($1, %I)] WHERE %I = ANY ($1)', tbl, col, col, col)
    USING old_values, new_values;
END $fn$;

-- A JSON object with each old key renamed to the new one at the same position,
-- keeping its value; other keys stay.
CREATE OR REPLACE FUNCTION pg_temp.rename_keys(obj JSONB, old_keys TEXT[], new_keys TEXT[])
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $fn$
  SELECT COALESCE(jsonb_object_agg(COALESCE(new_keys[array_position(old_keys, key)], key), value), '{}'::jsonb)
  FROM jsonb_each(obj)
$fn$;

-- Partial indexes that name a value, created again below.
DROP INDEX IF EXISTS positions_open_auto_idx;
DROP INDEX IF EXISTS orders_user_open_idx;
DROP INDEX IF EXISTS orders_open_idx;
DROP INDEX IF EXISTS orders_open_auto_idx;
DROP INDEX IF EXISTS algo_trades_user_open_idx;
DROP INDEX IF EXISTS algo_trades_user_closed_idx;
DROP INDEX IF EXISTS price_alerts_triggered_idx;
DROP INDEX IF EXISTS idx_stock_setup_signals_open;

-- CHECK constraints that list values, added again below with the new ones.
ALTER TABLE positions DROP CONSTRAINT IF EXISTS positions_source_check;
ALTER TABLE positions DROP CONSTRAINT IF EXISTS positions_horizon_check;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_source_check;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_type_check;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_limit_price_given_check;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_horizon_check;
ALTER TABLE algo_trades DROP CONSTRAINT IF EXISTS algo_trades_kind_check;
ALTER TABLE algo_trades DROP CONSTRAINT IF EXISTS algo_trades_mode_check;
ALTER TABLE algo_trades DROP CONSTRAINT IF EXISTS algo_trades_stage_check;
ALTER TABLE algo_trades DROP CONSTRAINT IF EXISTS algo_trades_horizon_check;
ALTER TABLE algo_trade_events DROP CONSTRAINT IF EXISTS algo_trade_events_stage_check;
ALTER TABLE price_alerts DROP CONSTRAINT IF EXISTS price_alerts_condition_check;
ALTER TABLE price_alerts DROP CONSTRAINT IF EXISTS price_alerts_status_check;

-- Paper positions (TradingMode, TradeSource, Horizon).
SELECT pg_temp.rename_values('positions', 'mode', ARRAY['paper', 'live'], ARRAY['Paper', 'Live']);
SELECT pg_temp.rename_values('positions', 'source', ARRAY['manual', 'auto'], ARRAY['Manual', 'Auto']);
SELECT pg_temp.rename_values('positions', 'horizon', ARRAY['intraday', 'positional'], ARRAY['Intraday', 'Positional']);
ALTER TABLE positions ALTER COLUMN mode SET DEFAULT 'Paper';
ALTER TABLE positions ALTER COLUMN source SET DEFAULT 'Manual';
ALTER TABLE positions ADD CONSTRAINT positions_source_check CHECK (source IN ('Manual', 'Auto'));
ALTER TABLE positions ADD CONSTRAINT positions_horizon_check CHECK (horizon IN ('Intraday', 'Positional'));

-- Paper orders (OrderStatus, TradeSource, OrderType, Horizon).
SELECT pg_temp.rename_values('orders', 'status', ARRAY['open', 'filled', 'cancelled'], ARRAY['Open', 'Filled', 'Cancelled']);
SELECT pg_temp.rename_values('orders', 'source', ARRAY['manual', 'auto'], ARRAY['Manual', 'Auto']);
SELECT pg_temp.rename_values('orders', 'order_type', ARRAY['limit', 'market'], ARRAY['Limit', 'Market']);
SELECT pg_temp.rename_values('orders', 'horizon', ARRAY['intraday', 'positional'], ARRAY['Intraday', 'Positional']);
ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'Open';
ALTER TABLE orders ALTER COLUMN source SET DEFAULT 'Manual';
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('Open', 'Filled', 'Cancelled'));
ALTER TABLE orders ADD CONSTRAINT orders_source_check CHECK (source IN ('Manual', 'Auto'));
ALTER TABLE orders ADD CONSTRAINT orders_order_type_check CHECK (order_type IN ('Limit', 'Market'));
ALTER TABLE orders ADD CONSTRAINT orders_limit_price_given_check CHECK ((order_type = 'Limit') = (limit_price IS NOT NULL));
ALTER TABLE orders ADD CONSTRAINT orders_horizon_check CHECK (horizon IN ('Intraday', 'Positional'));

-- Automated trades and their events (TradeKind, TradingMode, LifecycleStage, Horizon).
SELECT pg_temp.rename_values('algo_trades', 'kind',
  ARRAY['stock', 'stock-option', 'stock-future', 'index-option', 'index-future'],
  ARRAY['Stock', 'StockOption', 'StockFuture', 'IndexOption', 'IndexFuture']);
SELECT pg_temp.rename_values('algo_trades', 'mode', ARRAY['paper', 'live'], ARRAY['Paper', 'Live']);
SELECT pg_temp.rename_values('algo_trades', 'stage',
  ARRAY['selected', 'validated', 'rejected', 'executed', 'closed'],
  ARRAY['Selected', 'Validated', 'Rejected', 'Executed', 'Closed']);
SELECT pg_temp.rename_values('algo_trades', 'horizon', ARRAY['intraday', 'positional'], ARRAY['Intraday', 'Positional']);
SELECT pg_temp.rename_values('algo_trade_events', 'stage',
  ARRAY['selected', 'validated', 'rejected', 'executed', 'closed'],
  ARRAY['Selected', 'Validated', 'Rejected', 'Executed', 'Closed']);
ALTER TABLE algo_trades ADD CONSTRAINT algo_trades_kind_check
  CHECK (kind IN ('Stock', 'StockOption', 'StockFuture', 'IndexOption', 'IndexFuture'));
ALTER TABLE algo_trades ADD CONSTRAINT algo_trades_mode_check CHECK (mode IN ('Paper', 'Live'));
ALTER TABLE algo_trades ADD CONSTRAINT algo_trades_stage_check
  CHECK (stage IN ('Selected', 'Validated', 'Rejected', 'Executed', 'Closed'));
ALTER TABLE algo_trades ADD CONSTRAINT algo_trades_horizon_check CHECK (horizon IN ('Intraday', 'Positional'));
ALTER TABLE algo_trade_events ADD CONSTRAINT algo_trade_events_stage_check
  CHECK (stage IN ('Selected', 'Validated', 'Rejected', 'Executed', 'Closed'));

-- Price alerts (PriceAlertCondition, PriceAlertStatus).
SELECT pg_temp.rename_values('price_alerts', 'condition', ARRAY['above', 'below'], ARRAY['Above', 'Below']);
SELECT pg_temp.rename_values('price_alerts', 'status', ARRAY['active', 'triggered'], ARRAY['Active', 'Triggered']);
ALTER TABLE price_alerts ALTER COLUMN status SET DEFAULT 'Active';
ALTER TABLE price_alerts ADD CONSTRAINT price_alerts_condition_check CHECK (condition IN ('Above', 'Below'));
ALTER TABLE price_alerts ADD CONSTRAINT price_alerts_status_check CHECK (status IN ('Active', 'Triggered'));

-- Feedback (FeedbackType, FeedbackStatus).
SELECT pg_temp.rename_values('feedback', 'type',
  ARRAY['bug', 'feature', 'general', 'subscription'], ARRAY['Bug', 'Feature', 'General', 'Subscription']);
SELECT pg_temp.rename_values('feedback', 'status',
  ARRAY['open', 'reviewed', 'resolved'], ARRAY['Open', 'Reviewed', 'Resolved']);
ALTER TABLE feedback ALTER COLUMN status SET DEFAULT 'Open';

-- Subscriptions (SubscriptionState as stored, SubscriptionProvider).
SELECT pg_temp.rename_values('subscriptions', 'status',
  ARRAY['active', 'cancelled', 'expired'], ARRAY['Active', 'Cancelled', 'Expired']);
SELECT pg_temp.rename_values('subscriptions', 'provider', ARRAY['internal', 'admin'], ARRAY['Internal', 'Admin']);

-- Scheduled job runs (JobRunStatus).
SELECT pg_temp.rename_values('scheduled_job_runs', 'status',
  ARRAY['running', 'done', 'failed'], ARRAY['Running', 'Done', 'Failed']);

-- Stock setup signals (SetupOutcomeStatus, Side).
SELECT pg_temp.rename_values('stock_setup_signals', 'status',
  ARRAY['open', 'target', 'stop', 'expired'], ARRAY['Open', 'Target', 'Stop', 'Expired']);
SELECT pg_temp.rename_values('stock_setup_signals', 'direction', ARRAY['buy', 'sell'], ARRAY['BUY', 'SELL']);
ALTER TABLE stock_setup_signals ALTER COLUMN status SET DEFAULT 'Open';

-- algo_configuration.config: the trading mode, the horizons switches (keyed by
-- 1/2 before horizon was text) and the trade kinds' keys. Read by
-- GET/PUT /api/algo-configuration and the signals service. Only rows still
-- holding an old value change.
UPDATE algo_configuration
SET config = jsonb_set(config, '{mode}', to_jsonb(CASE config->>'mode' WHEN 'paper' THEN 'Paper' ELSE 'Live' END))
WHERE config->>'mode' IN ('paper', 'live');

UPDATE algo_configuration
SET config = jsonb_set(config, '{horizons}', pg_temp.rename_keys(config->'horizons',
  ARRAY['1', '2', 'intraday', 'positional'], ARRAY['Intraday', 'Positional', 'Intraday', 'Positional']))
WHERE jsonb_typeof(config->'horizons') = 'object'
  AND config->'horizons' ?| ARRAY['1', '2', 'intraday', 'positional'];

UPDATE algo_configuration
SET config = jsonb_set(config, '{kinds}', pg_temp.rename_keys(config->'kinds',
  ARRAY['stock', 'stock-option', 'stock-future', 'index-option', 'index-future'],
  ARRAY['Stock', 'StockOption', 'StockFuture', 'IndexOption', 'IndexFuture']))
WHERE jsonb_typeof(config->'kinds') = 'object'
  AND config->'kinds' ?| ARRAY['stock', 'stock-option', 'stock-future', 'index-option', 'index-future'];

-- ── Indexes, with the new predicates ──

-- Admin user list: non-admins, most recently updated first, 500 at a time.
CREATE INDEX IF NOT EXISTS users_non_admin_updated_idx ON users (updated_at DESC) WHERE NOT is_admin;

-- Open positions: the Positions page and Dashboard list them on every load,
-- and the merge looks a trade's open position up among them.
CREATE INDEX IF NOT EXISTS positions_open_idx ON positions (user_id, mode) WHERE NOT exited;
-- Closed trades: the Trade Journal and Dashboard select a user's exits by mode
-- and exit-time range (GET /api/positions?status=Closed, /daily-pnl, /stats).
CREATE INDEX IF NOT EXISTS positions_closed_idx ON positions (user_id, mode, exit_time) WHERE exited;
-- The trade monitor: every open automated position across users when the
-- market opens, and one user's again when their positions or settings change.
CREATE INDEX IF NOT EXISTS positions_open_auto_idx ON positions (user_id) WHERE source = 'Auto' AND NOT exited;
-- The session square-off: every user's open intraday paper positions opened
-- before the last session ended, oldest first (getOpenIntradayPositionsBefore).
CREATE INDEX IF NOT EXISTS positions_open_intraday_idx ON positions (mode, horizon, entry_time) WHERE NOT exited;

-- The Pending tab: a user's open orders whenever placed, newest first
-- (GET /api/orders?status=Open, getUserOpenOrders).
CREATE INDEX IF NOT EXISTS orders_user_open_idx ON orders (user_id, created_at DESC) WHERE status = 'Open';
-- The order service across all users: loading the open orders, and cancelling
-- the open ones placed before a time (at the close).
CREATE INDEX IF NOT EXISTS orders_open_idx ON orders (created_at) WHERE status = 'Open';
-- The entry rules: a user's automated orders still waiting, which count like
-- open positions (getWaitingAutoOrders).
CREATE INDEX IF NOT EXISTS orders_open_auto_idx ON orders (user_id) WHERE status = 'Open' AND source = 'Auto';

-- A user's automated trades still in progress.
CREATE INDEX IF NOT EXISTS algo_trades_user_open_idx ON algo_trades (user_id, stage) WHERE stage NOT IN ('Rejected', 'Closed');
-- GET /api/automation/results: a user's closed trades entered in a date range.
CREATE INDEX IF NOT EXISTS algo_trades_user_closed_idx ON algo_trades (user_id, created_at) WHERE stage = 'Closed';

-- Nightly purge of triggered alerts (040_purge_triggered_price_alerts.js).
CREATE INDEX IF NOT EXISTS price_alerts_triggered_idx ON price_alerts (user_id) WHERE status = 'Triggered';

-- Open stock setups by stock, checked against each new candle.
CREATE INDEX IF NOT EXISTS idx_stock_setup_signals_open ON stock_setup_signals (instrument_token) WHERE status = 'Open';
