const test = require('node:test');
const assert = require('node:assert');
const { checkRateLimit } = require('../lib/rateLimit');

test('art bucket counts images, not requests: a plates request spends PAGE_COUNT', () => {
  const { PAGE_COUNT } = require('../lib/pageCount');
  const ip = 'test-ip-' + Math.random();
  assert.strictEqual(checkRateLimit(ip, 'art', PAGE_COUNT), null);   // 11
  assert.strictEqual(checkRateLimit(ip, 'art', PAGE_COUNT), null);   // 22
  assert.strictEqual(checkRateLimit(ip, 'art', 1), null);            // 23 (a cover)
  for (let i = 0; i < 7; i++) assert.strictEqual(checkRateLimit(ip, 'art'), null); // 30
  const limited = checkRateLimit(ip, 'art');
  assert.ok(limited && limited.status === 429);
  // default bucket unaffected
  assert.strictEqual(checkRateLimit(ip), null);
});

test('a weighted request that would cross the cap is refused whole', () => {
  const ip = 'test-ip-' + Math.random();
  for (let i = 0; i < 25; i++) assert.strictEqual(checkRateLimit(ip, 'art'), null);
  const limited = checkRateLimit(ip, 'art', 11); // 36 > 30
  assert.ok(limited && limited.status === 429);
});

test('a refused weighted request counts nothing', () => {
  const ip = 'test-ip-' + Math.random();
  for (let i = 0; i < 25; i++) assert.strictEqual(checkRateLimit(ip, 'art'), null);
  const limited = checkRateLimit(ip, 'art', 11); // 36 > 30, refused
  assert.ok(limited && limited.status === 429);
  assert.strictEqual(checkRateLimit(ip, 'art', 1), null); // 26 <= 30, still admitted
});

test('an over-cap weight is refused with a finite positive Retry-After, and counts nothing', () => {
  // 1000 can never fit under the global ceiling of 300, so the window is the
  // only honest answer and must not come back as NaN.
  const ip = 'test-ip-' + Math.random();
  const limited = checkRateLimit(ip, 'art', 1000);
  assert.ok(limited && limited.status === 429);
  assert.ok(Number.isInteger(limited.retryAfterSeconds) && limited.retryAfterSeconds > 0,
    `retryAfterSeconds must be a positive integer, got ${limited.retryAfterSeconds}`);
  assert.strictEqual(checkRateLimit(ip, 'art', 1), null);
});
