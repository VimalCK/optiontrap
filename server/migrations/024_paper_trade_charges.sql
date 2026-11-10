-- Paper trades are charged what Zerodha would charge (shared/paperCharges.js):
-- brokerage, STT, exchange, SEBI, stamp duty, GST and DP, worked out when a
-- position closes. The Trade Journal, Algo Trading and Win/Loss Patterns show
-- P&L after them; Positions shows P&L before them, as Kite does.
--
-- No new indexes: these columns are only read from rows the existing queries
-- already select (by user, mode and exit time, or by position).

-- A closed position's charges: the total, subtracted in the journal's P&L SQL
-- (server/positionsQuery.js), and each charge, listed in the journal.
-- NULL for open positions, and for ones closed before charges were recorded
-- (their P&L stays as it was).
ALTER TABLE positions ADD COLUMN IF NOT EXISTS charges NUMERIC;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS charge_breakdown JSONB;

-- A closed automated trade's own charges (its entry and exit at its own
-- prices), subtracted in Win/Loss Patterns (server/autoTradeResults.js) and
-- the Algo Trading list. Several trades can share one merged position.
ALTER TABLE auto_trades ADD COLUMN IF NOT EXISTS charges NUMERIC;
