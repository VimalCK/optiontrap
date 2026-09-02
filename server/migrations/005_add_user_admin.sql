-- 005_add_user_admin — role-based admin flag on users.
-- Admin access is data-driven (no env vars). Flip is_admin to grant/revoke.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin INTEGER NOT NULL DEFAULT 0;

-- Bootstrap the initial admin. The row is created if the user has not logged
-- in yet; on next login upsertUser fills in user_name without resetting the
-- admin flag (it only updates user_name + updated_at).
INSERT INTO users (user_id, is_admin, updated_at)
VALUES ('UR5452', 1, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
ON CONFLICT (user_id) DO UPDATE SET is_admin = 1;
