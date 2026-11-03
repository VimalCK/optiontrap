-- Watched option-chain symbols last one trading day; each morning starts with
-- just NIFTY and BANKNIFTY. now() is in market time (the runner sets the zone).
DELETE FROM oi_snapshot_symbols
WHERE trade_date < to_char(now(), 'YYYY-MM-DD');
