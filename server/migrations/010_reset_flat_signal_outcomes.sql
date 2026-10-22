-- Signals whose only stored price was the entry day were marked as a final
-- 0% Loss. There was nothing to measure, so clear the outcome; it will be
-- re-evaluated once a later price is available.
UPDATE trade_setup_signals
SET outcome_price = NULL,
    outcome_date = NULL,
    outcome_return = NULL,
    outcome_status = NULL,
    max_favorable_return = NULL,
    max_adverse_return = NULL,
    outcome_final = FALSE
WHERE outcome_final
  AND outcome_price = entry_premium
  AND outcome_return = 0
  AND max_favorable_return = 0
  AND max_adverse_return = 0;
