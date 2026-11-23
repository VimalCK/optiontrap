-- A manual order's trailing stop-loss (the order popup's "Trail by", in ₹):
-- once the price reaches the order's target, the trade monitor trails the best
-- price by this much instead of exiting at the target. The fill carries it onto
-- the position, like the target and stop-loss. Null when it is off.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS trail_amount DOUBLE PRECISION;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS trail_amount DOUBLE PRECISION;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_trail_amount_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_trail_amount_check CHECK (trail_amount > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'positions_trail_amount_check') THEN
    ALTER TABLE positions ADD CONSTRAINT positions_trail_amount_check CHECK (trail_amount > 0);
  END IF;
END $$;

-- The trade monitor's manual channel: every open manual position with a target
-- or stop-loss, across users, when the market opens; and one user's again when
-- their manual orders fill (getAllOpenManualPositionsWithExits,
-- getOpenManualPositionsWithExits). A trailing stop-loss needs a target, so
-- the target covers it.
CREATE INDEX IF NOT EXISTS positions_open_manual_exits_idx ON positions (user_id)
  WHERE source = 'Manual' AND NOT exited AND (target_price IS NOT NULL OR stop_loss_price IS NOT NULL);
