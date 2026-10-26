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
