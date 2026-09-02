-- 006_add_plan_duration — generic subscription duration model.
-- Replaces the free-form `interval` string with a numeric count + unit so
-- plans like "7 days" or "2 years" are expressed safely. The legacy `interval`
-- column is kept for backward compatibility but is no longer used for logic.

ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS duration_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS duration_unit  TEXT    NOT NULL DEFAULT 'month';

-- Backfill from the existing interval strings for any pre-existing rows.
UPDATE subscription_plans SET duration_count = 1, duration_unit = 'month' WHERE interval = 'month';
UPDATE subscription_plans SET duration_count = 6, duration_unit = 'month' WHERE interval = '6 months';
UPDATE subscription_plans SET duration_count = 1, duration_unit = 'year'  WHERE interval = 'year';

-- Explicit values for the seeded plans (authoritative).
UPDATE subscription_plans SET duration_count = 1,  duration_unit = 'month' WHERE id = 'one_month';
UPDATE subscription_plans SET duration_count = 6,  duration_unit = 'month' WHERE id = 'six_months';
UPDATE subscription_plans SET duration_count = 12, duration_unit = 'month' WHERE id = 'twelve_months';
