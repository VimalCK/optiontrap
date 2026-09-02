-- 002_add_subscriptions — future-ready subscription model.

CREATE TABLE IF NOT EXISTS subscription_plans (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  price       DOUBLE PRECISION NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL DEFAULT 'INR',
  interval    TEXT NOT NULL DEFAULT 'month',
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at  TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                       TEXT PRIMARY KEY,
  user_id                  TEXT NOT NULL,
  plan_id                  TEXT NOT NULL,
  status                   TEXT NOT NULL,
  starts_at                TEXT,
  expires_at               TEXT,
  provider                 TEXT,
  provider_subscription_id TEXT,
  provider_payment_id      TEXT,
  created_at               TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at               TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

INSERT INTO subscription_plans (id, name, description, price, currency, interval, is_active, updated_at)
VALUES (
  'free',
  'Free',
  'Free access plan while OptionTrap subscriptions are being introduced.',
  0,
  'INR',
  'month',
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
