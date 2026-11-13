/** The new ID at login means an ID planted before login (session fixation) never becomes a logged-in session. */

const regenerate = (session) => new Promise((resolve, reject) => session.regenerate((err) => (err ? reject(err) : resolve())));
const save = (session) => new Promise((resolve, reject) => session.save((err) => (err ? reject(err) : resolve())));

/** Replaces the request's session (new ID, old one deleted). */
export async function startLoggedInSession(req, kiteSession) {
  await regenerate(req.session);
  req.session.kiteSession = kiteSession;
  await save(req.session);
}
