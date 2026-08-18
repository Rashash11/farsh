const test = require('node:test');
const assert = require('node:assert');
const { checkRateLimit } = require('../lib/rateLimit');

test('art bucket is stricter and independent of the default bucket', () => {
  const ip = 'test-ip-' + Math.random();
  for (let i = 0; i < 6; i++) assert.strictEqual(checkRateLimit(ip, 'art'), null);
  const limited = checkRateLimit(ip, 'art');
  assert.ok(limited && limited.status === 429);
  // default bucket unaffected
  assert.strictEqual(checkRateLimit(ip), null);
});
