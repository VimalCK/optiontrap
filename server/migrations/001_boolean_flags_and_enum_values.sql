-- Four changes, each safe to run again and on a database with data:
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
-- 4. The analysis values (shared/analysisEnums.js) stored as display text or
--    lower case become member names too: the stock scan's setups, states and
--    market relations, the OI setups' patterns, flows and selling setups, the
--    automated trades' setup patterns, and plan duration units. Every column
--    holding an enum value gets a CHECK listing its members.
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

-- ── 4. Analysis values as member names, and CHECKs on every enum column ──

-- `obj` with the string at `key` rewritten from each old value to the new
-- one at the same position; any other value, or none, leaves it as it is.
CREATE OR REPLACE FUNCTION pg_temp.renamed(obj JSONB, key TEXT, old_values TEXT[], new_values TEXT[])
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE WHEN obj->>key = ANY (old_values)
    THEN jsonb_set(obj, ARRAY[key], to_jsonb(new_values[array_position(old_values, obj->>key)]))
    ELSE obj END
$fn$;

-- Add CHECK `name` on `tbl` unless it exists. It is added NOT VALID (enforced
-- on every new or changed row) and then validated; an odd legacy row that
-- fails it leaves it unvalidated with a notice instead of failing startup.
CREATE OR REPLACE FUNCTION pg_temp.add_check(tbl TEXT, name TEXT, condition TEXT)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = name AND conrelid = tbl::regclass) THEN RETURN; END IF;
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID', tbl, name, condition);
  BEGIN
    EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', tbl, name);
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '% on % left unvalidated: some existing rows hold other values', name, tbl;
  END;
END $fn$;

-- Stock setup signals: the setup type (StockSetupType), shown on the stock
-- setups scorecard (GET /api/stock-setups/scorecard).
SELECT pg_temp.rename_values('stock_setup_signals', 'setup_type',
  ARRAY['pullback', 'reversal', 'breakout', 'rejection', 'breakdown'],
  ARRAY['Pullback', 'Reversal', 'Breakout', 'Rejection', 'Breakdown']);

-- The stock scan summary the watchlist's Setups column shows
-- (stock_candle_sync.scan_summary): the state (StockState), the market
-- relation (MarketRelation), and each setup's type and side.
UPDATE stock_candle_sync
SET scan_summary = pg_temp.renamed(pg_temp.renamed(scan_summary,
    'state', ARRAY['falling', 'stretched', 'turning', 'uptrend', 'sideways'],
    ARRAY['Falling', 'Stretched', 'Turning', 'Uptrend', 'Sideways']),
    'market', ARRAY['with-market', 'alone', 'stronger', 'in-line'], ARRAY['WithMarket', 'Alone', 'Stronger', 'InLine'])
WHERE scan_summary->>'state' IN ('falling', 'stretched', 'turning', 'uptrend', 'sideways')
   OR scan_summary->>'market' IN ('with-market', 'alone', 'stronger', 'in-line');

UPDATE stock_candle_sync
SET scan_summary = jsonb_set(scan_summary, '{setups}', (
  SELECT COALESCE(jsonb_agg(pg_temp.renamed(pg_temp.renamed(setup,
      'type', ARRAY['pullback', 'reversal', 'breakout', 'rejection', 'breakdown'],
      ARRAY['Pullback', 'Reversal', 'Breakout', 'Rejection', 'Breakdown']),
      'direction', ARRAY['buy', 'sell'], ARRAY['BUY', 'SELL']) ORDER BY position), '[]'::jsonb)
  FROM jsonb_array_elements(scan_summary->'setups') WITH ORDINALITY AS item(setup, position)))
WHERE jsonb_typeof(scan_summary->'setups') = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(scan_summary->'setups') AS item(setup)
              WHERE setup->>'type' IN ('pullback', 'reversal', 'breakout', 'rejection', 'breakdown')
                 OR setup->>'direction' IN ('buy', 'sell'));

-- Automated trades: the setup pattern behind each (SetupPattern), grouped by
-- GET /api/automation/results and shown on Algo Trading and Win/Loss Patterns.
SELECT pg_temp.rename_values('algo_trades', 'setup',
  ARRAY['Wall Defense', 'Velocity Confirmed', 'PCR Extreme', 'Theta Decay', 'Directional OI', 'PCR Shift', 'Risk/Reward'],
  ARRAY['WallDefense', 'VelocityConfirmed', 'PcrExtreme', 'ThetaDecay', 'DirectionalOi', 'PcrShift', 'RiskReward']);

-- OI trade setup signals' details (trade_setup_signals.details), sliced by the
-- OI History signal stats: the selling setup (SellingSetup), the option flow
-- (OiFlow) and the strike's OI pattern (RolloverPattern). The trends,
-- statuses, biases and fair value were already member names.
UPDATE trade_setup_signals
SET details = pg_temp.renamed(details, 'sellingType',
  ARRAY['Call Sell', 'Put Sell', 'Range Sell', 'No Sell'], ARRAY['CallSell', 'PutSell', 'RangeSell', 'NoSell'])
WHERE details->>'sellingType' IN ('Call Sell', 'Put Sell', 'Range Sell', 'No Sell');

UPDATE trade_setup_signals
SET details = pg_temp.renamed(details, 'ivFlow',
  ARRAY['Buyers Adding', 'Writers Adding', 'Buyers Exiting', 'Writers Covering', '-'],
  ARRAY['BuyersAdding', 'WritersAdding', 'BuyersExiting', 'WritersCovering', 'None'])
WHERE details->>'ivFlow' IN ('Buyers Adding', 'Writers Adding', 'Buyers Exiting', 'Writers Covering', '-');

UPDATE trade_setup_signals
SET details = pg_temp.renamed(details, 'strikePattern',
  ARRAY['Rolling Over (Long)', 'Rolling Over (Short)', 'Rolling Over', 'Exiting (Long Unwind)', 'Exiting (Short Cover)',
        'Fresh Build (Long)', 'Fresh Build (Short)', 'Fresh Build', 'Doubling Down (Long)', 'Doubling Down (Short)',
        'Doubling Down', 'Long Buildup', 'Short Buildup', 'Long Unwinding', 'Short Covering', '-'],
  ARRAY['RollingOverLong', 'RollingOverShort', 'RollingOver', 'ExitingLongUnwind', 'ExitingShortCover',
        'FreshBuildLong', 'FreshBuildShort', 'FreshBuild', 'DoublingDownLong', 'DoublingDownShort',
        'DoublingDown', 'LongBuildup', 'ShortBuildup', 'LongUnwinding', 'ShortCovering', 'None'])
WHERE details->>'strikePattern' IN ('Rolling Over (Long)', 'Rolling Over (Short)', 'Rolling Over', 'Exiting (Long Unwind)',
  'Exiting (Short Cover)', 'Fresh Build (Long)', 'Fresh Build (Short)', 'Fresh Build', 'Doubling Down (Long)',
  'Doubling Down (Short)', 'Doubling Down', 'Long Buildup', 'Short Buildup', 'Long Unwinding', 'Short Covering', '-');

-- Subscription plans' duration unit (DurationUnit), read by the plan list
-- (GET /api/subscription-plans) and when a subscription is activated or extended.
SELECT pg_temp.rename_values('subscription_plans', 'duration_unit',
  ARRAY['day', 'week', 'month', 'year'], ARRAY['Day', 'Week', 'Month', 'Year']);
ALTER TABLE subscription_plans ALTER COLUMN duration_unit SET DEFAULT 'Month';

-- A CHECK on every column holding an enum value, listing its members, so no
-- other spelling can be stored. Nullable columns still accept NULL.
SELECT pg_temp.add_check('positions', 'positions_side_check', $$side IN ('BUY', 'SELL')$$);
SELECT pg_temp.add_check('positions', 'positions_mode_check', $$mode IN ('Paper', 'Live')$$);
SELECT pg_temp.add_check('positions', 'positions_exchange_check', $$exchange IN ('NSE', 'BSE', 'NFO', 'BFO')$$);
SELECT pg_temp.add_check('orders', 'orders_exchange_check', $$exchange IN ('NSE', 'BSE', 'NFO', 'BFO')$$);
SELECT pg_temp.add_check('orders', 'orders_option_type_check', $$option_type IN ('CE', 'PE')$$);
SELECT pg_temp.add_check('feedback', 'feedback_type_check', $$type IN ('Bug', 'Feature', 'General', 'Subscription')$$);
SELECT pg_temp.add_check('feedback', 'feedback_status_check', $$status IN ('Open', 'Reviewed', 'Resolved')$$);
SELECT pg_temp.add_check('subscriptions', 'subscriptions_status_check', $$status IN ('Active', 'Cancelled', 'Expired')$$);
SELECT pg_temp.add_check('subscriptions', 'subscriptions_provider_check', $$provider IN ('Internal', 'Admin')$$);
SELECT pg_temp.add_check('scheduled_job_runs', 'scheduled_job_runs_status_check', $$status IN ('Running', 'Done', 'Failed')$$);
SELECT pg_temp.add_check('stock_setup_signals', 'stock_setup_signals_direction_check', $$direction IN ('BUY', 'SELL')$$);
SELECT pg_temp.add_check('stock_setup_signals', 'stock_setup_signals_status_check', $$status IN ('Open', 'Target', 'Stop', 'Expired')$$);
SELECT pg_temp.add_check('stock_setup_signals', 'stock_setup_signals_setup_type_check',
  $$setup_type IN ('Pullback', 'Reversal', 'Breakout', 'Rejection', 'Breakdown')$$);
SELECT pg_temp.add_check('trade_setup_signals', 'trade_setup_signals_action_check', $$action IN ('BUY', 'SELL')$$);
SELECT pg_temp.add_check('trade_setup_signals', 'trade_setup_signals_option_type_check', $$option_type IN ('CE', 'PE')$$);
SELECT pg_temp.add_check('trade_setup_signals', 'trade_setup_signals_status_check', $$status IN ('Confirmed', 'Watch', 'Avoid')$$);
SELECT pg_temp.add_check('trade_setup_signals', 'trade_setup_signals_outcome_status_check', $$outcome_status IN ('Open', 'Profit', 'Loss')$$);
SELECT pg_temp.add_check('instruments', 'instruments_exchange_check', $$exchange IN ('NSE', 'BSE', 'NFO', 'BFO')$$);
SELECT pg_temp.add_check('instruments', 'instruments_instrument_type_check', $$instrument_type IN ('CE', 'PE', 'FUT', 'EQ')$$);
SELECT pg_temp.add_check('watchlist_items', 'watchlist_items_exchange_check', $$exchange IN ('NSE', 'BSE', 'NFO', 'BFO')$$);
SELECT pg_temp.add_check('price_alerts', 'price_alerts_exchange_check', $$exchange IN ('NSE', 'BSE', 'NFO', 'BFO')$$);
SELECT pg_temp.add_check('oi_history_options', 'oi_history_options_option_type_check', $$option_type IN ('CE', 'PE')$$);
SELECT pg_temp.add_check('subscription_plans', 'subscription_plans_duration_unit_check', $$duration_unit IN ('Day', 'Week', 'Month', 'Year')$$);

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

-- The plans list and the default plan (getActiveSubscriptionPlans,
-- activateSubscription): active plans, cheapest first.
CREATE INDEX IF NOT EXISTS subscription_plans_active_price_idx ON subscription_plans (price, id) WHERE is_active;
