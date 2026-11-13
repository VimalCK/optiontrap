import { asyncRouter, withFailureMessage } from '../asyncRoutes.js';
import { admin, subscriber } from '../authMiddleware.js';
import { createConcurrencyLimit } from '../concurrencyLimit.js';
import {
  deleteOiHistoryByExpiryMonth,
  deleteOiHistoryByMonth,
  deleteOiHistoryByScrip,
  deleteTradeSetupSignal,
  evaluateTradeSetupSignalOutcomes,
  getOiHistoryDataByExpiryMonth,
  getOiHistoryFuturesData,
  getStoredOiHistoryExpiryMonths,
  getTradeSetupSignals,
  saveTradeSetupSignal,
  updateTradeSetupSignalOutcome,
} from '../db.js';
import { getOrFetchInstruments } from '../instruments.js';
import { OiHistoryFetchError, fetchOiHistoryMonth, todayIST } from '../oiHistoryFetch.js';
import { KITE_LOGIN_ENDED } from '../../shared/kiteAuth.js';
import { Exchange, isOptionType, isSide } from '../../shared/tradeEnums.js';
import { FetchEvent, SignalOutcome, StrikeMode, strikeModeFrom } from '../../shared/appEnums.js';
import { TradeSetupStatus, isTradeSetupStatus } from '../../shared/analysisEnums.js';
import { sendCreated, sendError, sendOk } from '../replies.js';

export const oiHistoryRoutes = asyncRouter();

/**
 * POST /api/oi-history/fetch. Body: { scrip: 'NIFTY', expiryMonth: 'YYYY-MM' }. Streams progress as SSE:
 *   step     — { step, message }
 *   progress — { done, total, pct, batch, totalBatches, symbol }
 *   done     — { rowCount, tradingDays, skippedDays, fetchedDays, uniqueTokens }
 *   error    — { message }
 *
 * One fetch at a time per user (429 otherwise): each makes many Kite calls and large writes.
 */
const oiHistoryFetches = createConcurrencyLimit(1);

oiHistoryRoutes.post('/api/oi-history/fetch', subscriber, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  if (!oiHistoryFetches.tryAcquire(userId)) {
    return sendError(res, 429, 'An OI history fetch is already running · wait for it to finish');
  }
  try {
    await streamOiHistoryFetch(req, res);
  } finally {
    oiHistoryFetches.release(userId);
  }
});

async function streamOiHistoryFetch(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // A cancel stops Kite calls and skips the save: a partial save would mark those dates as fetched and leave gaps.
  const cancel = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) cancel.abort();
  });

  try {
    const { scrip, expiryMonth, strikeMode = StrikeMode.AtmRange, specificStrike } = req.body;
    const { apiKey, accessToken } = req.session.kiteSession;
    const summary = await fetchOiHistoryMonth({
      scrip, expiryMonth, strikeMode: strikeModeFrom(strikeMode), specificStrike, apiKey, accessToken, send, signal: cancel.signal,
    });

    // Score open signals before the client reloads, since new prices may settle them.
    try {
      await evaluateTradeSetupSignalOutcomes(scrip);
    } catch (err) {
      console.warn('[OI History] Signal outcome evaluation failed:', err.message);
    }

    send(FetchEvent.Done, summary);
    res.end();
  } catch (err) {
    if (cancel.signal.aborted) {
      console.log(`[OI History] Fetch cancelled by client for ${req.body?.scrip} ${req.body?.expiryMonth}`);
      return;
    }
    if (err.authFailure) {
      send(FetchEvent.Error, { message: 'Your Kite login has ended · log in again', code: KITE_LOGIN_ENDED });
      return res.end();
    }
    if (err instanceof OiHistoryFetchError) {
      send(FetchEvent.Error, { message: err.message });
      return res.end();
    }
    console.error('[OI History] Fetch error:', err);
    send(FetchEvent.Error, { message: 'OI history fetch failed on the server' });
    res.end();
  }
}

// ?scrip=NIFTY: the months with stored history, plus the next three live expiry months.
oiHistoryRoutes.get('/api/oi-history/expiry-months', subscriber, withFailureMessage('Failed to load expiry months', async (req, res) => {
  const { scrip } = req.query;
  if (!scrip) {
    return sendError(res, 400, 'scrip is required');
  }

  const { apiKey, accessToken } = req.session.kiteSession;
  const instruments = await getOrFetchInstruments(apiKey, accessToken);
  const minExpiryDate = todayIST();
  const liveMonths = [...new Set(
    instruments
      .filter((inst) =>
        inst.name === scrip &&
        inst.exchange === Exchange.NFO &&
        isOptionType(inst.instrumentType) &&
        inst.expiry &&
        inst.expiry >= minExpiryDate
      )
      .map((inst) => inst.expiry.slice(0, 7))
      .sort(),
  )].slice(0, 3);

  const months = [...new Set([
    ...await getStoredOiHistoryExpiryMonths(scrip),
    ...liveMonths,
  ])].sort();
  sendOk(res, months);
}));

// ?scrip=NIFTY&expiryMonth=YYYY-MM[&from=YYYY-MM-DD]: stored OI history for one expiry month. The month is
// required, so a request can't read a scrip's whole stored history at once.
oiHistoryRoutes.get('/api/oi-history', subscriber, withFailureMessage('Failed to load OI history', async (req, res) => {
  const { scrip, from, expiryMonth } = req.query;
  if (!scrip || !expiryMonth) {
    return sendError(res, 400, 'scrip and expiryMonth are required');
  }
  sendOk(res, await getOiHistoryDataByExpiryMonth(scrip, expiryMonth, from || null));
}));

oiHistoryRoutes.get('/api/oi-history/futures', subscriber, withFailureMessage('Failed to load futures OI history', async (req, res) => {
  const { scrip, expiryMonth, from } = req.query;
  if (!scrip || !expiryMonth) return sendError(res, 400, 'scrip and expiryMonth are required');
  sendOk(res, await getOiHistoryFuturesData(scrip, expiryMonth, from || null));
}));

oiHistoryRoutes.post('/api/oi-history/signals', subscriber, withFailureMessage('Failed to save trade setup signal', async (req, res) => {
  const { scrip, signalDate, expiry, strike, optionType, action, status, entryPremium, spotPrice, details } = req.body || {};
  if (!scrip || !signalDate || !Number.isFinite(Number(strike)) || !isOptionType(optionType) || !isSide(action) || (status && !isTradeSetupStatus(status))) {
    return sendError(res, 400, 'Invalid trade setup signal');
  }
  const signal = await saveTradeSetupSignal(req.session.kiteSession.userId, {
    scrip, signalDate, expiry, strike: Number(strike), optionType, action,
    status: status || TradeSetupStatus.Watch, entryPremium: Number(entryPremium) || null,
    spotPrice: Number(spotPrice) || null, details,
  });
  sendCreated(res, signal);
}));

oiHistoryRoutes.get('/api/oi-history/signals', subscriber, withFailureMessage('Failed to load trade setup signals', async (req, res) => {
  sendOk(res, await getTradeSetupSignals(req.session.kiteSession.userId, {
    scrip: req.query.scrip || null,
    limit: req.query.limit,
  }));
}));

oiHistoryRoutes.delete('/api/oi-history/signals/:id', subscriber, withFailureMessage('Failed to delete signal', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return sendError(res, 400, 'Invalid signal id');
  }
  const deleted = await deleteTradeSetupSignal(req.session.kiteSession.userId, id);
  if (!deleted) return sendError(res, 404, 'Signal not found');
  sendOk(res);
}));

oiHistoryRoutes.patch('/api/oi-history/signals/:id/outcome', subscriber, withFailureMessage('Failed to save signal outcome', async (req, res) => {
  const { price, date, returnPct, status, maxFavorableReturn, maxAdverseReturn, final } = req.body || {};
  if (!Number.isFinite(Number(price)) || !date || !Number.isFinite(Number(returnPct)) ||
      !Number.isFinite(Number(maxFavorableReturn)) || !Number.isFinite(Number(maxAdverseReturn)) ||
      !Object.values(SignalOutcome).includes(status)) {
    return sendError(res, 400, 'Invalid signal outcome');
  }
  const outcome = await updateTradeSetupSignalOutcome(req.session.kiteSession.userId, req.params.id, {
    price: Number(price), date, returnPct: Number(returnPct), status,
    maxFavorableReturn: Number(maxFavorableReturn), maxAdverseReturn: Number(maxAdverseReturn), final: Boolean(final),
  });
  if (!outcome) return sendError(res, 404, 'Signal not found');
  sendOk(res, outcome);
}));

// ?scrip=…, ?scrip=…&expiryMonth=YYYY-MM or ?month=YYYY-MM. Admins only: the history is shared by every user,
// not owned by the one asking.
oiHistoryRoutes.delete('/api/oi-history', admin, withFailureMessage('Failed to delete OI history', async (req, res) => {
  const { scrip, month, expiryMonth } = req.query;

  if (scrip && !expiryMonth) {
    const deleted = await deleteOiHistoryByScrip(scrip);
    console.log(`[OI History] Deleted ${deleted} rows for ${scrip}`);
    return sendOk(res, { deleted });
  }

  if (expiryMonth) {
    if (!scrip) {
      return sendError(res, 400, 'scrip is required');
    }
    if (!/^\d{4}-\d{2}$/.test(expiryMonth)) {
      return sendError(res, 400, 'expiryMonth is required (format: YYYY-MM)');
    }
    const deleted = await deleteOiHistoryByExpiryMonth(scrip, expiryMonth);
    console.log(`[OI History] Deleted ${deleted} rows for ${scrip} expiry month ${expiryMonth}`);
    return sendOk(res, { deleted });
  }

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return sendError(res, 400, 'expiryMonth is required (format: YYYY-MM)');
  }

  const deleted = await deleteOiHistoryByMonth(month);
  console.log(`[OI History] Deleted ${deleted} rows for month ${month}`);
  sendOk(res, { deleted });
}));
