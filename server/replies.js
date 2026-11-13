/**
 * The JSON envelope every route sends: `{ status: 'ok', data }` or `{ status: 'error', message }`. Written here only.
 */

const OK = 'ok';

const ERROR = 'error';

/** A success body: `data` plus any extra top-level fields (e.g. `authenticated`). */
const okReply = (data, fields = {}) => ({ status: OK, ...fields, data });

/** A failure body: the message plus any extra fields (`code`, `data`). */
const errorReply = (message, fields = {}) => ({ status: ERROR, ...fields, message });

/** Reply 200 with `data` (left out of the body when undefined). */
export const sendOk = (res, data, fields) => res.json(okReply(data, fields));

export const sendCreated = (res, data) => res.status(201).json(okReply(data));

/** Reply with an HTTP error status and a message the user can read. */
export const sendError = (res, httpStatus, message, fields) => res.status(httpStatus).json(errorReply(message, fields));
