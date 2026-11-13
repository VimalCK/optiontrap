import crypto from 'crypto';
import { DurationUnit, SubscriptionProvider, SubscriptionState } from '../../shared/appEnums.js';
import { sqlEnum } from '../sql.js';
import { firstRow, query, rows } from './pool.js';

function mapPlan(row) {
  if (!row) return null;
  return {
    id: row.plan_id || row.id,
    name: row.plan_name || row.name,
    description: row.plan_description || row.description,
    currency: row.plan_currency || row.currency,
    price: Number(row.plan_price ?? row.price ?? 0),
    durationCount: Number(row.plan_duration_count ?? row.duration_count ?? 1),
    durationUnit: row.plan_duration_unit || row.duration_unit || DurationUnit.Month,
    isActive: Boolean(row.plan_is_active ?? row.is_active),
  };
}

function mapSubscription(row) {
  if (!row) return null;

  const expiresAt = row.expires_at || null;
  const expired = expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false;

  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    status: expired && row.status === SubscriptionState.Active ? SubscriptionState.Expired : row.status,
    active: row.status === SubscriptionState.Active && !expired,
    startsAt: row.starts_at || null,
    expiresAt,
    provider: row.provider || null,
    providerSubscriptionId: row.provider_subscription_id || null,
    providerPaymentId: row.provider_payment_id || null,
    updatedAt: row.updated_at,
    plan: mapPlan(row),
  };
}

function formatDbTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function addPlanDuration(fromDate, durationCount, durationUnit) {
  const d = new Date(fromDate.getTime());
  const count = Math.max(1, parseInt(durationCount, 10) || 1);

  switch (durationUnit) {
    case DurationUnit.Day:
      d.setDate(d.getDate() + count);
      break;
    case DurationUnit.Week:
      d.setDate(d.getDate() + count * 7);
      break;
    case DurationUnit.Month:
      d.setMonth(d.getMonth() + count);
      break;
    case DurationUnit.Year:
      d.setFullYear(d.getFullYear() + count);
      break;
    default:
      d.setMonth(d.getMonth() + count);
      break;
  }

  return d;
}

function getPlanExpiryDate(durationCount, durationUnit) {
  return addPlanDuration(new Date(), durationCount, durationUnit);
}

function parseDbTimestamp(value) {
  if (!value) return null;
  const d = new Date(value.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function getActiveSubscriptionPlans() {
  const result = await rows(
    'SELECT * FROM subscription_plans WHERE is_active ORDER BY price ASC, id ASC',
  );

  return result.map(mapPlan);
}

export async function getUserSubscription(userId) {
  const row = await firstRow(
    `SELECT
       s.*,
       p.id AS plan_id,
       p.name AS plan_name,
       p.description AS plan_description,
       p.price AS plan_price,
       p.currency AS plan_currency,
       p.duration_count AS plan_duration_count,
       p.duration_unit AS plan_duration_unit,
       p.is_active AS plan_is_active
     FROM subscriptions s
     JOIN subscription_plans p ON p.id = s.plan_id
     WHERE s.user_id = $1
     ORDER BY s.updated_at DESC
     LIMIT 1`,
    [userId],
  );

  return mapSubscription(row);
}

/** The message is safe to show the user. */
export class SubscriptionPlanNotFoundError extends Error {
  constructor() {
    super('Subscription plan not found');
    this.name = 'SubscriptionPlanNotFoundError';
  }
}

/** The plan a user gets when they pick none: the first of the plans list (cheapest first). */
async function defaultPlanId() {
  const row = await firstRow('SELECT id FROM subscription_plans WHERE is_active ORDER BY price ASC, id ASC LIMIT 1');
  return row?.id;
}

export async function activateSubscription(userId, planId, provider = SubscriptionProvider.Internal) {
  const plan = await requirePlan(planId ?? await defaultPlanId());

  const id = crypto.randomUUID();
  const startsAt = formatDbTimestamp(new Date());
  const expiresAt = formatDbTimestamp(getPlanExpiryDate(plan.duration_count, plan.duration_unit));

  await query(
    `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at, provider, updated_at)
     VALUES ($1, $2, $3, ${sqlEnum(SubscriptionState.Active)}, $4, $5, $6, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
     ON CONFLICT (id) DO NOTHING`,
    [id, userId, plan.id, startsAt, expiresAt, provider],
  );

  const existing = await firstRow(
    'SELECT id FROM subscriptions WHERE user_id = $1 AND id <> $2 ORDER BY updated_at DESC LIMIT 1',
    [userId, id],
  );

  if (existing) {
    await query(
      `UPDATE subscriptions SET
        plan_id = $1,
        status = ${sqlEnum(SubscriptionState.Active)},
        starts_at = $2,
        expires_at = $3,
        provider = $4,
        updated_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
       WHERE id = $5`,
      [plan.id, startsAt, expiresAt, provider, existing.id],
    );
    await query('DELETE FROM subscriptions WHERE id = $1', [id]);
    return getUserSubscription(userId);
  }

  return getUserSubscription(userId);
}

async function setUserSubscription(userId, planId, startsAt, expiresAt, status, provider = SubscriptionProvider.Admin) {
  const existing = await firstRow(
    'SELECT id FROM subscriptions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [userId],
  );

  if (existing) {
    await query(
      `UPDATE subscriptions SET
         plan_id = $1, status = $2, starts_at = $3, expires_at = $4, provider = $5,
         updated_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
       WHERE id = $6`,
      [planId, status, startsAt, expiresAt, provider, existing.id],
    );
  } else {
    await query(
      `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at, provider, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))`,
      [crypto.randomUUID(), userId, planId, status, startsAt, expiresAt, provider],
    );
  }

  return getUserSubscription(userId);
}

async function requirePlan(planId) {
  const plan = await firstRow(
    'SELECT id, duration_count, duration_unit FROM subscription_plans WHERE id = $1 AND is_active',
    [planId],
  );
  if (!plan) throw new SubscriptionPlanNotFoundError();
  return plan;
}

export async function adminActivateSubscription(userId, planId) {
  const plan = await requirePlan(planId);
  const startsAt = formatDbTimestamp(new Date());
  const expiresAt = formatDbTimestamp(getPlanExpiryDate(plan.duration_count, plan.duration_unit));
  return setUserSubscription(userId, planId, startsAt, expiresAt, SubscriptionState.Active);
}

/** Extend from the current expiry if still in the future, otherwise from now. */
export async function adminExtendSubscription(userId, planId) {
  const plan = await requirePlan(planId);
  const current = await getUserSubscription(userId);

  const currentExpiry = current ? parseDbTimestamp(current.expiresAt) : null;
  const base = currentExpiry && currentExpiry.getTime() > Date.now() ? currentExpiry : new Date();

  const startsAt = current?.startsAt || formatDbTimestamp(new Date());
  const expiresAt = formatDbTimestamp(addPlanDuration(base, plan.duration_count, plan.duration_unit));
  return setUserSubscription(userId, planId, startsAt, expiresAt, SubscriptionState.Active);
}

/** Cancel the user's subscription (keeps dates, marks status cancelled). */
export async function adminCancelSubscription(userId) {
  const existing = await firstRow(
    'SELECT id FROM subscriptions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [userId],
  );
  if (!existing) return null;

  await query(
    `UPDATE subscriptions SET status = ${sqlEnum(SubscriptionState.Cancelled)}, updated_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
     WHERE id = $1`,
    [existing.id],
  );
  return getUserSubscription(userId);
}
