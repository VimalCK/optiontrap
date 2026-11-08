-- The General settings and entry rules now decide whether to enter a trade
-- before anything is saved (server/autoTradeEngine.js): a signal they refuse
-- is only logged. Trades they refused earlier were saved as rejected at
-- selection, with no validated event; delete those (their events go with
-- them, ON DELETE CASCADE). Trades rejected after validation, because they
-- could not be placed, are kept, as are executed and closed trades.
--
-- A one-off clean-up, not a query the app runs: it reads the rejected trades
-- once and checks each one's events by auto_trade_events_trade_idx.
DELETE FROM auto_trades t
WHERE t.stage = 'rejected'
  AND NOT EXISTS (
    SELECT 1 FROM auto_trade_events e
    WHERE e.auto_trade_id = t.id AND e.stage = 'validated'
  );
