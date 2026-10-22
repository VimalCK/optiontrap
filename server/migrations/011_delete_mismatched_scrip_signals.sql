-- A scrip switch could log the previous scrip's signal under the new scrip.
-- Such rows have a spot price far from the scrip's own spot on that day.
DELETE FROM trade_setup_signals s
USING (
  SELECT scrip, date, MAX(spot_close) AS spot
  FROM oi_history
  WHERE spot_close > 0
  GROUP BY scrip, date
) d
WHERE d.scrip = s.scrip
  AND d.date = s.signal_date
  AND s.spot_price > 0
  AND ABS(s.spot_price - d.spot) / d.spot > 0.2;
