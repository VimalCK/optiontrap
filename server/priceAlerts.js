const CONDITIONS = ['above', 'below'];
const MAX_NOTE_LENGTH = 200;

/**
 * Check a new alert from the client. Returns `{ alert }` ready to store, or
 * `{ error }` with a message for the user.
 */
export function parsePriceAlertInput(body) {
  const { instrumentToken, tradingsymbol, exchange, condition, value, note, browserNotification } = body || {};

  const token = Number(instrumentToken);
  if (!Number.isInteger(token) || token <= 0) return { error: 'instrumentToken is required' };
  if (typeof tradingsymbol !== 'string' || !tradingsymbol.trim()) return { error: 'tradingsymbol is required' };
  if (!CONDITIONS.includes(condition)) return { error: 'condition must be above or below' };

  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) return { error: 'value must be a price above 0' };

  const trimmedNote = typeof note === 'string' ? note.trim() : '';
  if (trimmedNote.length > MAX_NOTE_LENGTH) return { error: `note must be at most ${MAX_NOTE_LENGTH} characters` };

  return {
    alert: {
      instrumentToken: token,
      tradingsymbol: tradingsymbol.trim(),
      exchange: typeof exchange === 'string' && exchange.trim() ? exchange.trim() : 'NSE',
      condition,
      value: price,
      note: trimmedNote || null,
      browserNotification: browserNotification === true,
    },
  };
}
