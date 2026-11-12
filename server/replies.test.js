import { describe, expect, it } from 'vitest';
import { sendCreated, sendError, sendOk } from './replies.js';

/** A stand-in Express response that records the status and the JSON text sent. */
const fakeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = JSON.parse(JSON.stringify(body)); return res; };
  return res;
};

describe('reply envelope', () => {
  it('sends success as { status: ok, data }, with no data key when there is none', () => {
    expect(sendOk(fakeRes(), [1])).toMatchObject({ statusCode: 200, body: { status: 'ok', data: [1] } });
    expect(sendOk(fakeRes()).body).toEqual({ status: 'ok' });
    expect(sendOk(fakeRes(), null, { authenticated: false }).body).toEqual({ status: 'ok', authenticated: false, data: null });
  });

  it('sends a created resource with 201', () => {
    expect(sendCreated(fakeRes(), { id: 1 })).toMatchObject({ statusCode: 201, body: { status: 'ok', data: { id: 1 } } });
  });

  it('sends failure as { status: error, message } with the HTTP status and any code', () => {
    expect(sendError(fakeRes(), 404, 'Not found')).toMatchObject({ statusCode: 404, body: { status: 'error', message: 'Not found' } });
    expect(sendError(fakeRes(), 402, 'Pay', { code: 'SUBSCRIPTION_REQUIRED' }).body)
      .toEqual({ status: 'error', code: 'SUBSCRIPTION_REQUIRED', message: 'Pay' });
  });
});
