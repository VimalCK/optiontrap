/**
 * A failure reply never carries the error's own text: a Postgres or Kite message can expose SQL, table names or upstream details.
 */

import { sendError } from './replies.js';

const ROUTE_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** Thrown errors and rejected promises go to `next` instead of crashing the process. */
function passErrorsToNext(handler) {
  if (typeof handler !== 'function' || handler.length === 4) return handler;
  return (req, res, next) => {
    try {
      const result = handler(req, res, next);
      if (result && typeof result.then === 'function') result.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

export function catchAsyncErrors(app) {
  for (const method of ROUTE_METHODS) {
    const register = app[method].bind(app);
    app[method] = (path, ...handlers) => {
      if (handlers.length === 0) return register(path);
      return register(path, ...handlers.map(passErrorsToNext));
    };
  }
}

export function sendFailure(res, err, { log, message, status = 500 }) {
  console.error(`${log}:`, err);
  sendError(res, status, message);
}

/** Body-parser 4xx errors keep their status; anything else is a 500. */
export function sendServerError(err, req, res, _next) {
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(`[Server] ${req.method} ${req.originalUrl} failed:`, err);
  if (res.headersSent) {
    res.end();
    return;
  }
  sendError(res, status, status === 500 ? 'Something went wrong on the server' : 'Invalid request');
}
