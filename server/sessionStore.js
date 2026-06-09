/**
 * SQLite Session Store for express-session
 *
 * Persists sessions to the same SQLite database used for credentials.
 * Sessions survive server restarts — no more losing all user sessions
 * when the process recycles.
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

export class SqliteSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this._cleanupInterval = setInterval(
      () => cleanExpiredSessions(),
      options.cleanupInterval || DEFAULT_CLEANUP_INTERVAL,
    );

    // Don't block process exit
    if (this._cleanupInterval.unref) {
      this._cleanupInterval.unref();
    }
  }

  get(sid, callback) {
    try {
      const data = getSessionById(sid);
      callback(null, data);
    } catch (err) {
      callback(err);
    }
  }

  set(sid, sessionData, callback) {
    try {
      const maxAge = sessionData?.cookie?.maxAge || 86400000;
      setSessionData(sid, sessionData, maxAge);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      deleteSession(sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  touch(sid, sessionData, callback) {
    try {
      const maxAge = sessionData?.cookie?.maxAge || 86400000;
      touchSession(sid, maxAge);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  close() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
  }
}
