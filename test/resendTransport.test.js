const test = require('node:test');
const assert = require('node:assert');
const { sendEmail } = require('../lib/resendTransport');

const msg = () => ({ to: ['a@b.co'], from: 'Farsh! <orders@x.dev>', subject: 'Hi', text: 'Body' });

test('sends via the Resend REST API and returns its id', async () => {
  let sentBody;
  const fetchFn = async (url, opts) => {
    sentBody = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ id: 'abc123' }) };
  };
  const result = await sendEmail(msg(), { apiKey: 'k', fetchFn });
  assert.strictEqual(result.id, 'abc123');
  assert.deepStrictEqual(sentBody.to, ['a@b.co']);
});

test('throws without an API key, rather than silently skipping the send', async () => {
  await assert.rejects(() => sendEmail(msg(), { apiKey: '' }), /email_not_configured/);
});

test('a rejection from Resend surfaces as an error', async () => {
  const fetchFn = async () => ({ ok: false, status: 422, json: async () => ({ message: 'bad' }) });
  await assert.rejects(() => sendEmail(msg(), { apiKey: 'k', fetchFn }), /email_rejected: 422/);
});

test('a network failure surfaces as an error', async () => {
  const fetchFn = async () => { throw new Error('ECONNRESET'); };
  await assert.rejects(() => sendEmail(msg(), { apiKey: 'k', fetchFn }), /email_transport_failed/);
});
