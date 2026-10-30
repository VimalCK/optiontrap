-- Delete OI history for expiry months before M-1 (IST), for every scrip.
-- The OI History page, zones and position risk only read M-1 onwards, the
-- same cutoff as the page's manual "delete old months" button.
DELETE FROM oi_history
WHERE substr(expiry, 1, 7) < to_char(date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') - interval '1 month', 'YYYY-MM');

DELETE FROM oi_history_futures
WHERE substr(expiry, 1, 7) < to_char(date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') - interval '1 month', 'YYYY-MM');
