const test = require('node:test');
const assert = require('node:assert');
const { sign, verify } = require('../lib/orderToken');

const SECRET = 'test-secret-do-not-use-in-prod';
const summary = () => ({ orderNumber: 'FA-1234', email: 'parent@example.com', names: 'Layla', total: '$60' });

test('a token signed with a secret verifies back to the same summary', () => {
  const token = sign(summary(), { secret: SECRET });
  assert.deepStrictEqual(verify(token, { secret: SECRET }), summary());
});

test('signing without a configured secret throws not_configured, not a silent default', () => {
  assert.throws(() => sign(summary(), { secret: '' }), (err) => err.code === 'not_configured');
});

test('verifying without a configured secret throws not_configured', () => {
  const token = sign(summary(), { secret: SECRET });
  assert.throws(() => verify(token, { secret: '' }), (err) => err.code === 'not_configured');
});

test('a token with a tampered payload is rejected, not silently accepted', () => {
  const token = sign(summary(), { secret: SECRET });
  const [payload, sig] = token.split('.');
  const tamperedPayload = Buffer.from(JSON.stringify({ ...summary(), total: '$6' })).toString('base64url');
  assert.throws(() => verify(`${tamperedPayload}.${sig}`, { secret: SECRET }), (err) => err.code === 'invalid_token');
});

test('a token with a tampered signature is rejected', () => {
  const token = sign(summary(), { secret: SECRET });
  const [payload] = token.split('.');
  assert.throws(() => verify(`${payload}.not-a-real-signature`, { secret: SECRET }), (err) => err.code === 'invalid_token');
});

test('a malformed token (no signature part) is rejected', () => {
  assert.throws(() => verify('not-a-token', { secret: SECRET }), (err) => err.code === 'invalid_token');
});

test('a token signed with one secret does not verify under another', () => {
  const token = sign(summary(), { secret: SECRET });
  assert.throws(() => verify(token, { secret: 'a-different-secret' }), (err) => err.code === 'invalid_token');
});
