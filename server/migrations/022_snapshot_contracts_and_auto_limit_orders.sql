-- What each token in an OI snapshot is, saved with the snapshot itself
-- (server/oiSnapshotScheduler.js → saveOiSnapshot), so a snapshot exported for
-- analysis can be read without the day's instrument list: a JSON map of token →
-- { symbol, underlying, type, strike, expiry } for options, and
-- { symbol, underlying, type: 'SPOT' } for each underlying's price row.
-- Nullable: older rows have none. Only written and read with the whole row by
-- timestamp (the existing unique index), so no new index.
ALTER TABLE oi_snapshots ADD COLUMN IF NOT EXISTS contracts TEXT;

-- Automated limit orders: with the Entry limit offset entry rule on, the trade
-- engine (server/autoTradeEngine.js) enters through a paper limit order
-- instead of at the last price. `source` says who placed an order (its fill
-- opens a position with the same source), and `auto_trade_id` is the automated
-- trade it belongs to, moved to executed or rejected when the order fills or
-- is cancelled. Existing orders were all placed by hand.
ALTER TABLE paper_orders ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paper_orders_source_check') THEN
    ALTER TABLE paper_orders ADD CONSTRAINT paper_orders_source_check CHECK (source IN ('manual', 'auto'));
  END IF;
END $$;
ALTER TABLE paper_orders ADD COLUMN IF NOT EXISTS auto_trade_id TEXT REFERENCES auto_trades (id) ON DELETE SET NULL;

-- The foreign key: clearing the link when an automated trade is deleted stays an index lookup.
CREATE INDEX IF NOT EXISTS paper_orders_auto_trade_idx ON paper_orders (auto_trade_id) WHERE auto_trade_id IS NOT NULL;
-- The entry rules (getWaitingAutoOrders): a user's automated orders still
-- waiting, which count like open positions. Only those rows are indexed.
CREATE INDEX IF NOT EXISTS paper_orders_open_auto_idx ON paper_orders (user_id) WHERE status = 'open' AND source = 'auto';
