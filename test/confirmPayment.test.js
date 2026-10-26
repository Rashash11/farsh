const test = require('node:test');
const assert = require('node:assert');
const { sign } = require('../lib/orderToken');
const { composeConfirmedEmail, composeRejectedEmail, sendPaymentDecision } = require('../lib/confirmPayment');

const SECRET = 'test-secret-do-not-use-in-prod';
const summary = () => ({ orderNumber: 'FA-1234', email: 'parent@example.com', names: 'Layla', total: '$60' });
const tokenFor = (s = summary()) => sign(s, { secret: SECRET });

test('the confirmed email tells the customer their book is being made', () => {
  const { subject, text } = composeConfirmedEmail(summary());
  assert.match(subject, /FA-1234/);
  assert.match(text, /confirmed/i);
});

test('the rejected email asks the customer to resend proof of payment', () => {
  const { subject, text } = composeRejectedEmail(summary());
  assert.match(subject, /FA-1234/);
  assert.match(text, /resend|screenshot/i);
});

test('confirming a valid token emails the customer the confirmed message', async () => {
  let sent;
  const fetchFn = async (url, opts) => { sent = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ id: 'abc' }) }; };
  const result = await sendPaymentDecision(tokenFor(), 'confirm', { secret: SECRET, apiKey: 'k', fetchFn });
  assert.strictEqual(result.orderNumber, 'FA-1234');
  assert.deepStrictEqual(sent.to, ['parent@example.com']);
  assert.match(sent.subject, /FA-1234/);
});

test('rejecting a valid token emails the customer the rejected message', async () => {
  let sent;
  const fetchFn = async (url, opts) => { sent = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ id: 'abc' }) }; };
  const result = await sendPaymentDecision(tokenFor(), 'reject', { secret: SECRET, apiKey: 'k', fetchFn });
  assert.strictEqual(result.action, 'reject');
  assert.match(sent.text, /resend|screenshot/i);
});

test('an unknown action is refused before any token verification or send', async () => {
  await assert.rejects(
    () => sendPaymentDecision(tokenFor(), 'delete-everything', { secret: SECRET, apiKey: 'k' }),
    (err) => err.code === 'invalid_action',
  );
});

test('a tampered token is refused, and no email is sent', async () => {
  let sendAttempted = false;
  const fetchFn = async () => { sendAttempted = true; return { ok: true, status: 200, json: async () => ({}) }; };
  const [payload, sig] = tokenFor().split('.');
  await assert.rejects(
    () => sendPaymentDecision(`${payload}.${sig}x`, 'confirm', { secret: SECRET, apiKey: 'k', fetchFn }),
    (err) => err.code === 'invalid_token',
  );
  assert.strictEqual(sendAttempted, false);
});

test('a send failure propagates rather than being reported as confirmed', async () => {
  const fetchFn = async () => ({ ok: false, status: 500, json: async () => ({ message: 'down' }) });
  await assert.rejects(() => sendPaymentDecision(tokenFor(), 'confirm', { secret: SECRET, apiKey: 'k', fetchFn }), /email_rejected/);
});
