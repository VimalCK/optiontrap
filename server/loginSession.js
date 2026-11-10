/**
 * Starting a logged-in session. The session gets a new ID at login, so an ID handed out before
 * login (one an attacker may have planted in the victim's browser: session fixation) never
 * becomes a logged-in session. Only `kiteSession` lives in the session, so nothing else is lost.
 */

/** Promise wrappers for express-session's callback methods. */
const regenerate = (session) => new Promise((resolve, reject) => session.regenerate((err) => (err ? reject(err) : resolve())));
const save = (session) => new Promise((resolve, reject) => session.save((err) => (err ? reject(err) : resolve())));

/** Replace the request's session with a new one (new ID, old one deleted) holding this Kite login, and save it. */
export async function startLoggedInSession(req, kiteSession) {
  await regenerate(req.session);
  req.session.kiteSession = kiteSession;
  await save(req.session);
}
