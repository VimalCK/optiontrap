-- Triggered price alerts have done their job: drop them. Active ones stay.
DELETE FROM price_alerts WHERE status = 'triggered';
