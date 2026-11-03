-- Watched option-chain symbols last one trading day; each morning starts with
-- just NIFTY and BANKNIFTY.
DELETE FROM oi_snapshot_symbols
WHERE trade_date < to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD');
