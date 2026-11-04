-- Delete stored candles and sync rows for stocks no longer in any watchlist.
-- The market reference index (instruments.is_market_reference) is kept: every
-- stock's market check compares against it.
DELETE FROM stock_daily_candles c
WHERE NOT EXISTS (SELECT 1 FROM instruments i WHERE i.instrument_token = c.instrument_token AND i.is_market_reference)
  AND NOT EXISTS (SELECT 1 FROM watchlist_items wi WHERE wi.instrument_token = c.instrument_token);

DELETE FROM stock_candle_sync s
WHERE NOT EXISTS (SELECT 1 FROM instruments i WHERE i.instrument_token = s.instrument_token AND i.is_market_reference)
  AND NOT EXISTS (SELECT 1 FROM watchlist_items wi WHERE wi.instrument_token = s.instrument_token);

-- Open setups of those stocks would stay open forever (only watchlist stocks
-- are scanned), so drop them. Finished setups stay for the scorecard.
DELETE FROM stock_setup_signals g
WHERE g.status = 'open'
  AND NOT EXISTS (SELECT 1 FROM watchlist_items wi WHERE wi.instrument_token = g.instrument_token);
