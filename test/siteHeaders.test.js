// test/siteHeaders.test.js
//
// The browser-facing security headers and the list of repo paths that must
// never be served live in lib/siteHeaders.js. server.js applies them; on
// Vercel the same values have to be copied into vercel.json, so this test
// also holds the two in step.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { SECURITY_HEADERS, isHiddenPath } = require('../lib/siteHeaders');

test('the headers forbid framing, sniffing and referrer leaks', () => {
  const csp = SECURITY_HEADERS['Content-Security-Policy'];
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /img-src[^;]*\*\.public\.blob\.vercel-storage\.com/);
  assert.match(csp, /script-src[^;]*cdn\.jsdelivr\.net/);
  assert.match(csp, /font-src[^;]*fonts\.gstatic\.com/);
  assert.strictEqual(SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff');
  assert.strictEqual(SECURITY_HEADERS['X-Frame-Options'], 'DENY');
  assert.strictEqual(SECURITY_HEADERS['Referrer-Policy'], 'no-referrer');
});

test('source, tests, docs and notes are hidden; the site itself is not', () => {
  for (const p of ['/lib/orderToken.js', '/test/placeOrder.test.js', '/CLAUDE.md', '/README.md',
    '/REVIEW-master.md', '/github.md', '/docs/x.md', '/tools/trial.js', '/server.js',
    '/.github/workflows/test.yml', '/api/place-order.js', '/package.json', '/.vercelignore', '/.env']) {
    assert.strictEqual(isHiddenPath(p), true, p + ' must be hidden');
  }
  for (const p of ['/', '/Landing Page.dc.html', '/Landing%20Page.dc.html', '/Checkout.dc.html',
    '/support.js', '/image-slot.js', '/page-transitions.js', '/favicon.ico',
    '/_ds/modernist/styles.css', '/uploads/covers/great-adventure.jpg', '/api/place-order']) {
    assert.strictEqual(isHiddenPath(p), false, p + ' must stay public');
  }
});

test('vercel.json carries the same headers for every path', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const all = (cfg.headers || []).find((h) => h.source === '/(.*)');
  assert.ok(all, 'vercel.json needs a headers entry for /(.*)');
  const got = Object.fromEntries(all.headers.map((h) => [h.key, h.value]));
  assert.deepStrictEqual(got, SECURITY_HEADERS);
});

test('vercel.json redirects the hidden paths away before the filesystem is consulted', () => {
  // Vercel evaluates redirects before static files and rewrites after them,
  // so only a redirect can hide a file that really exists in the upload.
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  assert.strictEqual(cfg.rewrites, undefined, 'rewrites cannot hide existing files');
  const hidden = (cfg.redirects || []).filter((r) => r.source !== '/');
  assert.ok(hidden.length >= 3, 'expected redirects for source dirs, dotfiles and markdown');
  for (const r of hidden) {
    assert.strictEqual(r.destination, '/');
    assert.strictEqual(r.permanent, false, 'a hidden path must not be cached as a permanent redirect');
  }
  const sources = hidden.map((r) => r.source).join('\n');
  for (const dir of ['lib', 'test', 'docs', 'tools', 'api']) assert.match(sources, new RegExp('\\b' + dir + '\\b'));
  assert.match(sources, /md/);
});
