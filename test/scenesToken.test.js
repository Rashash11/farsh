// test/scenesToken.test.js
const test = require('node:test');
const assert = require('node:assert');
const { signScenes, verifyScenes } = require('../lib/scenesToken');

const deps = { secret: 'test-secret' };
const scenes = ['a door', 'a dragon', 'home'];

test('a signed scenes array round-trips', () => {
  const token = signScenes(scenes, deps);
  assert.deepStrictEqual(verifyScenes(token, deps), scenes);
});

test('a tampered token is refused', () => {
  const token = signScenes(scenes, deps);
  const [payload, sig] = token.split('.');
  const other = Buffer.from(JSON.stringify({ scenes: ['the face of anyone I like'] })).toString('base64url');
  assert.throws(() => verifyScenes(`${other}.${sig}`, deps), (e) => e.code === 'invalid_token');
  assert.throws(() => verifyScenes(`${payload}.AAAA`, deps), (e) => e.code === 'invalid_token');
});

test('a token signed under another secret is refused', () => {
  const token = signScenes(scenes, { secret: 'other' });
  assert.throws(() => verifyScenes(token, deps), (e) => e.code === 'invalid_token');
});

test('without a secret, signing and verifying both fail loudly', () => {
  const saved = process.env.ORDER_CONFIRM_SECRET;
  delete process.env.ORDER_CONFIRM_SECRET;
  try {
    assert.throws(() => signScenes(scenes), (e) => e.code === 'not_configured');
    assert.throws(() => verifyScenes('x.y'), (e) => e.code === 'not_configured');
  } finally {
    if (saved !== undefined) process.env.ORDER_CONFIRM_SECRET = saved;
  }
});

test('a token that verifies but does not hold a scenes array is refused', () => {
  const { sign } = require('../lib/orderToken');
  assert.throws(() => verifyScenes(sign({ orderNumber: 'FA-1' }, deps), deps), (e) => e.code === 'invalid_token');
});
