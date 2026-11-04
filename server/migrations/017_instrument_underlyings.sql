-- Our own settings on an underlying's price row (the NSE index row such as
-- "NIFTY 50", or a stock's NSE EQ row). Zerodha's list has no field linking an
-- index to its F&O name, so that link and the display details live here,
-- beside the Zerodha columns. The daily sync updates only the Zerodha
-- columns and keeps these (see saveInstruments in db.js).
--
--   fno_name            F&O name the index's contracts carry ("NIFTY" for "NIFTY 50").
--                       Null on stock rows: a stock's F&O name is its tradingsymbol.
--   label               Display name; null shows the F&O name.
--   tradingview_symbol  TradingView symbol when it differs from the tradingsymbol.
--   always_snapshot     Option-chain OI snapshot every trading day.
--   is_market_reference The index the market's direction is read from.
ALTER TABLE instruments
  ADD COLUMN IF NOT EXISTS fno_name            TEXT,
  ADD COLUMN IF NOT EXISTS label               TEXT,
  ADD COLUMN IF NOT EXISTS tradingview_symbol  TEXT,
  ADD COLUMN IF NOT EXISTS always_snapshot     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_market_reference BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS instruments_fno_name_idx ON instruments (fno_name) WHERE fno_name IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS instruments_market_reference_idx ON instruments (is_market_reference) WHERE is_market_reference;

-- Settings for the F&O indices, on their rows from the Kite sync. Rows not
-- loaded yet are left alone: the instruments table only ever holds what
-- Kite returns.
UPDATE instruments AS i SET
  fno_name = v.fno_name,
  label = v.label,
  tradingview_symbol = v.tradingview_symbol,
  always_snapshot = v.always_snapshot,
  is_market_reference = v.is_market_reference
FROM (VALUES
  ('NIFTY 50',          'NIFTY',      'NIFTY 50',   'NIFTY',            true,  true),
  ('NIFTY BANK',        'BANKNIFTY',  'BANK NIFTY', 'BANKNIFTY',        true,  false),
  ('NIFTY FIN SERVICE', 'FINNIFTY',   NULL,         'CNXFINANCE',       false, false),
  ('NIFTY MID SELECT',  'MIDCPNIFTY', NULL,         'NIFTY_MID_SELECT', false, false),
  ('NIFTY NEXT 50',     'NIFTYNXT50', NULL,         'NIFTYNXT50',       false, false)
) AS v (tradingsymbol, fno_name, label, tradingview_symbol, always_snapshot, is_market_reference)
WHERE i.exchange = 'NSE' AND i.tradingsymbol = v.tradingsymbol;

-- OI History used to store NIFTY under its own alias "NIFTY50"; every other
-- scrip is stored by its F&O name. Store NIFTY by its F&O name too, so all
-- scrips are looked up the same way (through the underlying's price row).
UPDATE oi_history          SET scrip = 'NIFTY' WHERE scrip = 'NIFTY50';
UPDATE oi_history_futures  SET scrip = 'NIFTY' WHERE scrip = 'NIFTY50';
UPDATE trade_setup_signals SET scrip = 'NIFTY' WHERE scrip = 'NIFTY50';
