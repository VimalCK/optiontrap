-- 003_update_subscription_plans — replace initial free/3-month seed with duration plans.

INSERT INTO subscription_plans (id, name, description, price, currency, interval, is_active, updated_at)
VALUES
  (
    'one_month',
    '1 Month',
    'Monthly OptionTrap access. Payment integration coming soon.',
    0,
    'INR',
    'month',
    1,
    to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  ),
  (
    'six_months',
    '6 Months',
    'Half-yearly OptionTrap access. Payment integration coming soon.',
    999,
    'INR',
    '6 months',
    1,
    to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  ),
  (
    'twelve_months',
    '12 Months',
    'Annual OptionTrap access. Payment integration coming soon.',
    2999,
    'INR',
    'year',
    1,
    to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price = EXCLUDED.price,
  currency = EXCLUDED.currency,
  interval = EXCLUDED.interval,
  is_active = EXCLUDED.is_active,
  updated_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS');

UPDATE subscriptions
SET plan_id = 'one_month', updated_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
WHERE plan_id IN ('free', 'three_months');

DELETE FROM subscription_plans WHERE id IN ('free', 'three_months');
