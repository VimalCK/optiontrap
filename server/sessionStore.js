/**
 * PostgreSQL Session Store for express-session
 *
 * Persists sessions to the same PostgreSQL database used by the app.
 * Sessions survive server restarts.
 *
 * Expired sessions are pruned every 15 minutes automatically.
 */

import session from 'express-session';
import {
  getSessionById,
  setSessionData,
  deleteSession,
  touchSession,
  cleanExpiredSessions,
} from './db.js';

const DEFAULT_CLEANUP_INTERVAL = 15 * 60 * 1000; // 15 minutes

export class PostgresSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this._cleanupInterval = setInterval(
      () => { cleanExpiredSessions().catch(() => {}); },
      options.cleanupInterval || DEFAULT_CLEANUP_INTERVAL,
    );

    // Don't block process exit
    if (this._cleanupInterval.unref) {
      this._cleanupInterval.unref();
    }
  }

  get(sid, callback) {
    getSessionById(sid)
      .then((data) => callback(null, data))
      .catch((err) => callback(err));
  }

  set(sid, sessionData, callback) {
    const maxAge = sessionData?.cookie?.maxAge || 86400000;
    setSessionData(sid, sessionData, maxAge)
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  destroy(sid, callback) {
    deleteSession(sid)
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  touch(sid, sessionData, callback) {
    const maxAge = sessionData?.cookie?.maxAge || 86400000;
    touchSession(sid, maxAge)
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  close() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
  }
}
