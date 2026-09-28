const test = require('node:test');
const assert = require('node:assert');
const { clientIp } = require('../lib/clientIp');
const { checkRateLimit } = require('../lib/rateLimit');

const PROXIED = { VERCEL: '1' };
const req = (headers, remoteAddress = '203.0.113.7') => ({ headers, socket: { remoteAddress } });

test('with no proxy in front, forwarded headers are ignored entirely', () => {
  // This is the dev-mode bypass: curl -H 'X-Forwarded-For: anything'
  const ip = clientIp(req({ 'x-forwarded-for': '1.2.3.4' }), {});
  assert.strictEqual(ip, '203.0.113.7');
});

test('behind a proxy, the RIGHTMOST forwarded entry wins, not the client-supplied left', () => {
  const ip = clientIp(req({ 'x-forwarded-for': '6.6.6.6, 198.51.100.9' }), PROXIED);
  assert.strictEqual(ip, '198.51.100.9');
});

test('platform headers outrank x-forwarded-for', () => {
  const headers = {
    'x-forwarded-for': '6.6.6.6',
    'x-vercel-forwarded-for': '198.51.100.9',
  };
  assert.strictEqual(clientIp(req(headers), PROXIED), '198.51.100.9');
});

test('x-real-ip is used when x-vercel-forwarded-for is absent', () => {
  const headers = { 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '198.51.100.22' };
  assert.strictEqual(clientIp(req(headers), PROXIED), '198.51.100.22');
});

test('normalizes IPv6-mapped IPv4, ports, and bracketed IPv6', () => {
  assert.strictEqual(clientIp(req({}, '::ffff:192.0.2.5'), {}), '192.0.2.5');
  assert.strictEqual(clientIp(req({}, '192.0.2.5:51234'), {}), '192.0.2.5');
  assert.strictEqual(clientIp(req({}, '[2001:db8::1]:443'), {}), '2001:db8::1');
  assert.strictEqual(clientIp(req({}, '2001:db8::1'), {}), '2001:db8::1'); // bare IPv6 untouched
});

test('falls back to unknown rather than throwing', () => {
  assert.strictEqual(clientIp({}, {}), 'unknown');
  assert.strictEqual(clientIp({ headers: {} }, PROXIED), 'unknown');
});

test('header arrays take the last value', () => {
  const ip = clientIp(req({ 'x-forwarded-for': ['1.1.1.1', '9.9.9.9, 198.51.100.4'] }), PROXIED);
  assert.strictEqual(ip, '198.51.100.4');
});

test('regression: rotating x-forwarded-for no longer buys a fresh allowance', () => {
  // The original bug: keying on the leftmost entry gave every forged header its
  // own bucket, so the per-IP limit never fired. Same real client throughout.
  const real = '198.51.100.' + Math.floor(Math.random() * 200);
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    seen.add(clientIp(req({ 'x-forwarded-for': `10.0.0.${i}, ${real}` }), PROXIED));
  }
  assert.strictEqual(seen.size, 1, 'all eight requests must resolve to one identity');

  const ip = [...seen][0];
  for (let i = 0; i < 5; i++) assert.strictEqual(checkRateLimit(ip, 'art'), null);
  assert.strictEqual(checkRateLimit(ip, 'art'), null); // art allows 6
  const limited = checkRateLimit(ip, 'art');
  assert.ok(limited && limited.status === 429, 'the 7th request must be rate limited');
});
