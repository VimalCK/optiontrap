-- Drop the free-text strategy tag from positions and paper orders.
--
-- The tag was a label set by the browser ("Quick Trade", "Manual", "OI Chart",
-- or typed in the order popup) and only ever displayed. Who placed a trade is
-- the server-set `source` column (manual / auto), which the screens now show
-- instead, so nothing reads or writes the tag any more. No index uses it.
ALTER TABLE positions DROP COLUMN IF EXISTS strategy_tag;
ALTER TABLE paper_orders DROP COLUMN IF EXISTS strategy_tag;
