// test/artRoute.test.js
//
// Drives server.js's artRoute wrapper with fake req/res objects: the token,
// consent and rate-limit checks live in the wrapper, not in lib/generateArt,
// so only a route-level test can see them.
const test = require('node:test');
const assert = require('node:assert');

// Set before server.js loads dotenv, which never overrides an existing value.
process.env.ORDER_CONFIRM_SECRET = 'art-route-test-secret';
process.env.DOTENV_CONFIG_QUIET = 'true';
delete process.env.VERCEL;
delete process.env.TRUST_PROXY;

const { artRoute } = require('../server');
const { signScenes } = require('../lib/scenesToken');
const { checkRateLimit, BUCKETS } = require('../lib/rateLimit');
const { PAGE_COUNT } = require('../lib/pageCount');

const scenes = Array.from({ length: PAGE_COUNT }, (_, i) => 'signed scene ' + i);
const signed = { scenes, looks: 'signed looks', age: '6', title: 'Signed title', direction: 2 };

let ipSeq = 0;
function fakeReq(body) {
  return { body, headers: {}, socket: { remoteAddress: '10.9.0.' + (++ipSeq) } };
}
function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
const goodBook = () => ({
  audience: 'child', photo: 'data:image/png;base64,AAAA', photoConsent: true,
  title: 'client title', direction: 0, scenes: ['client scene'],
  data: { name: 'Nova', looks: 'client looks', age: '40' },
});

// The wrapper logs refusals for the operator; keep the test output clean.
async function quietly(fn) {
  const saved = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = saved; }
}

test('a bad token is refused with invalid_scenes and nothing is drawn', async () => {
  let called = false;
  const route = artRoute(async () => { called = true; return {}; });
  for (const scenesToken of [undefined, 'x.y', signScenes(signed).replace(/.$/, 'A') + 'A']) {
    const res = fakeRes();
    await quietly(() => route(fakeReq({ book: goodBook(), scenesToken }), res));
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.error, 'invalid_scenes');
  }
  assert.strictEqual(called, false);
});

test('without photo consent the route refuses before anything reaches Google', async () => {
  let called = false;
  const route = artRoute(async () => { called = true; return {}; });
  for (const photoConsent of [undefined, false, 'true']) {
    const res = fakeRes();
    await quietly(() => route(fakeReq({ book: { ...goodBook(), photoConsent }, scenesToken: signScenes(signed) }), res));
    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(res.body, { error: 'consent_required', message: 'Please confirm the photo consent first.' });
  }
  assert.strictEqual(called, false);
});

test('the handler sees the signed fields, never the client ones', async () => {
  let seen = null;
  const route = artRoute(async (book) => { seen = book; return { ok: 1 }; });
  const res = fakeRes();
  await route(fakeReq({ book: goodBook(), scenesToken: signScenes(signed) }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { ok: 1 });
  assert.deepStrictEqual(seen.scenes, scenes);
  assert.strictEqual(seen.title, 'Signed title');
  assert.strictEqual(seen.direction, 2);
  assert.strictEqual(seen.data.looks, 'signed looks');
  assert.strictEqual(seen.data.age, '6');
  assert.strictEqual(seen.data.name, 'Nova');
});

test('the route charges its weight against the art bucket', async () => {
  const route = artRoute(async () => ({}), { weight: PAGE_COUNT });
  const req = fakeReq({ book: goodBook(), scenesToken: signScenes(signed) });
  await route(req, fakeRes());
  const ip = req.socket.remoteAddress;
  // Exactly what is left of the allowance is admitted, one more is not.
  assert.strictEqual(checkRateLimit(ip, 'art', BUCKETS.art.perIpMax - PAGE_COUNT), null);
  assert.ok(checkRateLimit(ip, 'art', 1));
});
