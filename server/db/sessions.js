import { firstRow, query } from './pool.js';

export async function getSessionById(sid) {
  const row = await firstRow('SELECT data, expires FROM sessions WHERE sid = $1', [sid]);
  if (!row) return null;

  if (Number(row.expires) < Date.now()) {
    await query('DELETE FROM sessions WHERE sid = $1', [sid]);
    return null;
  }

  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

export async function setSessionData(sid, sessionData, maxAge) {
  const expires = Date.now() + (maxAge || 86400000);
  const data = JSON.stringify(sessionData);
  // Kept in its own column so admin sessions can be found without parsing every session.
  const isAdmin = sessionData?.kiteSession?.isAdmin === true;

  await query(
    `INSERT INTO sessions (sid, data, expires, is_admin) VALUES ($1, $2, $3, $4)
     ON CONFLICT (sid) DO UPDATE SET data = EXCLUDED.data, expires = EXCLUDED.expires, is_admin = EXCLUDED.is_admin`,
    [sid, data, expires, isAdmin],
  );
}

export async function deleteSession(sid) {
  await query('DELETE FROM sessions WHERE sid = $1', [sid]);
}

export async function touchSession(sid, maxAge) {
  const expires = Date.now() + (maxAge || 86400000);
  await query('UPDATE sessions SET expires = $1 WHERE sid = $2', [expires, sid]);
}

export async function cleanExpiredSessions() {
  const res = await query('DELETE FROM sessions WHERE expires < $1', [Date.now()]);
  return res.rowCount;
}
