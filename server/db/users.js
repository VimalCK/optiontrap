import { SubscriptionState } from '../../shared/appEnums.js';
import { firstRow, query, rows } from './pool.js';

export async function upsertUser(userId, userName) {
  await query(
    `INSERT INTO users (user_id, user_name, updated_at)
     VALUES ($1, $2, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
     ON CONFLICT (user_id) DO UPDATE SET
       user_name  = COALESCE(EXCLUDED.user_name, users.user_name),
       updated_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`,
    [userId, userName],
  );
}

export async function deleteUser(userId) {
  await query('DELETE FROM users WHERE user_id = $1', [userId]);
}

/** Admins bypass subscription checks. */
export async function isUserAdmin(userId) {
  const row = await firstRow('SELECT is_admin FROM users WHERE user_id = $1', [userId]);
  return Boolean(row?.is_admin);
}

export async function getAdminUsers() {
  const result = await rows(
    `SELECT
       u.user_id,
       u.user_name,
       u.is_admin,
       u.updated_at AS last_login,
       (SELECT COUNT(*) FROM feedback f WHERE f.user_id = u.user_id)::int AS feedback_count,
       s.status       AS sub_status,
       s.expires_at   AS sub_expires,
       s.plan_id      AS sub_plan_id,
       p.name         AS sub_plan_name,
       p.duration_count AS sub_duration_count,
       p.duration_unit  AS sub_duration_unit
     FROM users u
     LEFT JOIN LATERAL (
       SELECT * FROM subscriptions s2 WHERE s2.user_id = u.user_id ORDER BY s2.updated_at DESC LIMIT 1
     ) s ON TRUE
     LEFT JOIN subscription_plans p ON p.id = s.plan_id
     WHERE NOT u.is_admin
     ORDER BY u.updated_at DESC
     LIMIT 500`,
  );

  return result.map((row) => {
    const expiry = row.sub_expires || null;
    const expired = expiry ? new Date(String(expiry).replace(' ', 'T')).getTime() <= Date.now() : false;
    const status = expired && row.sub_status === SubscriptionState.Active ? SubscriptionState.Expired : (row.sub_status || SubscriptionState.Inactive);

    return {
      userId: row.user_id,
      userName: row.user_name || null,
      isAdmin: Boolean(row.is_admin),
      lastLogin: row.last_login || null,
      feedbackCount: row.feedback_count || 0,
      subscription: {
        status,
        active: row.sub_status === SubscriptionState.Active && !expired,
        planId: row.sub_plan_id || null,
        planName: row.sub_plan_name || null,
        expiresAt: expiry,
        durationCount: row.sub_duration_count != null ? Number(row.sub_duration_count) : null,
        durationUnit: row.sub_duration_unit || null,
      },
    };
  });
}

export async function getUsageStats() {
  const sessions = await firstRow(
    'SELECT COUNT(*) FILTER (WHERE expires > $1)::int AS active FROM sessions',
    [Date.now()],
  );
  const users = await firstRow('SELECT COUNT(*)::int AS total FROM users');

  return {
    activeSessions: sessions?.active || 0,
    totalUsers: users?.total || 0,
  };
}

/** Scheduled jobs fetch shared market data with an admin's token, never another user's. */
export async function getAdminKiteSessions() {
  // Only admin sessions are read (sessions_admin_idx), not every user's.
  const result = await rows('SELECT data FROM sessions WHERE is_admin AND expires > $1', [Date.now()]);
  return result
    .map((r) => {
      try {
        return JSON.parse(r.data)?.kiteSession;
      } catch {
        return null;
      }
    })
    .filter((kite) => kite?.isAdmin && kite.apiKey && kite.accessToken)
    .sort((a, b) => String(b.loginTime || '').localeCompare(String(a.loginTime || '')));
}
