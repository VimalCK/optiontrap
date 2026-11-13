import { describe, expect, it } from 'vitest';
import { PLAN_NOT_FOUND, sendResult } from './sendResult.js';

const fakeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = JSON.parse(JSON.stringify(body)); return res; };
  return res;
};

const refused = (code) => sendResult(fakeRes(), { ok: false, code, message: 'No' });

describe('sendResult', () => {
  it('sends a success with its data, 201 when created', () => {
    expect(sendResult(fakeRes(), { ok: true }, { data: { id: 'o1' } })).toMatchObject({ statusCode: 200, body: { status: 'ok', data: { id: 'o1' } } });
    expect(sendResult(fakeRes(), { ok: true }, { data: { id: 'o1' }, created: true }).statusCode).toBe(201);
  });

  it("maps each refusal code to its HTTP status and keeps the code in the body", () => {
    expect(refused('INVALID_TRADE').statusCode).toBe(400);
    expect(refused('MARKET_CLOSED')).toMatchObject({ statusCode: 409, body: { status: 'error', code: 'MARKET_CLOSED', message: 'No' } });
    expect(refused('NOT_FOUND').statusCode).toBe(404);
    expect(refused('NO_PRICE').statusCode).toBe(502);
    expect(refused(PLAN_NOT_FOUND).statusCode).toBe(400);
  });

  it('answers 400 for a code it does not know', () => {
    expect(refused('SOMETHING_NEW').statusCode).toBe(400);
  });
});
