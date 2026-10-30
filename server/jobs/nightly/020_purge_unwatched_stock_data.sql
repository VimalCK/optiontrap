-- Delete stored candles and sync rows for stocks no longer in any watchlist.
-- NIFTY 50 (256265) is kept: it is the market reference for every stock.
-- stock_setup_signals is kept: the setup scorecard counts every past signal.
DELETE FROM stock_daily_candles c
WHERE c.instrument_token <> 256265
  AND NOT EXISTS (SELECT 1 FROM watchlist_items wi WHERE wi.instrument_token = c.instrument_token);

DELETE FROM stock_candle_sync s
WHERE s.instrument_token <> 256265
  AND NOT EXISTS (SELECT 1 FROM watchlist_items wi WHERE wi.instrument_token = s.instrument_token);
