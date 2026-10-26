// test/scenesToken.test.js
const test = require('node:test');
const assert = require('node:assert');
const { signScenes, verifyScenes, tokenFieldsFor, adoptSignedStory } = require('../lib/scenesToken');
const { sign } = require('../lib/orderToken');
const { PAGE_COUNT } = require('../lib/pageCount');

const deps = { secret: 'test-secret' };
const scenes = Array.from({ length: PAGE_COUNT }, (_, i) => 'scene ' + i);
const fields = { scenes, looks: 'curly hair', age: '7', title: 'Nova and the door', direction: 1 };

// Re-sign a hand-built payload under the real secret, so these tests prove
// the SHAPE checks refuse it — not merely the signature check.
const forge = (payload) => sign(payload, deps);

test('a signed story round-trips every field the image model sees', () => {
  const token = signScenes(fields, deps);
  assert.deepStrictEqual(verifyScenes(token, deps), { kind: 'scenes', ...fields });
});

test('signing coerces strings and falls back to direction 0', () => {
  const t = verifyScenes(signScenes({ scenes, looks: 'x', age: 7, title: 't', direction: 'nope' }, deps), deps);
  assert.strictEqual(t.age, '7');
  assert.strictEqual(t.direction, 0);
});

test('signing refuses scenes that are not PAGE_COUNT strings', () => {
  for (const bad of [undefined, [], scenes.slice(1), [...scenes, 'extra'], scenes.map((s, i) => (i === 3 ? 42 : s))]) {
    assert.throws(() => signScenes({ ...fields, scenes: bad }, deps), (e) => e.code === 'invalid_scenes');
  }
});

test('a tampered token is refused', () => {
  const token = signScenes(fields, deps);
  const [payload, sig] = token.split('.');
  const other = Buffer.from(JSON.stringify({ kind: 'scenes', ...fields, scenes: scenes.map(() => 'the face of anyone I like') })).toString('base64url');
  assert.throws(() => verifyScenes(`${other}.${sig}`, deps), (e) => e.code === 'invalid_token');
  assert.throws(() => verifyScenes(`${payload}.AAAA`, deps), (e) => e.code === 'invalid_token');
});

test('tampered looks are refused', () => {
  const [, sig] = signScenes(fields, deps).split('.');
  const other = Buffer.from(JSON.stringify({ kind: 'scenes', ...fields, looks: 'someone else entirely' })).toString('base64url');
  assert.throws(() => verifyScenes(`${other}.${sig}`, deps), (e) => e.code === 'invalid_token');
});

test('a token signed under another secret is refused', () => {
  const token = signScenes(fields, { secret: 'other' });
  assert.throws(() => verifyScenes(token, deps), (e) => e.code === 'invalid_token');
});

test('without a secret, signing and verifying both fail loudly', () => {
  const saved = process.env.ORDER_CONFIRM_SECRET;
  delete process.env.ORDER_CONFIRM_SECRET;
  try {
    assert.throws(() => signScenes(fields), (e) => e.code === 'not_configured');
    assert.throws(() => verifyScenes('x.y'), (e) => e.code === 'not_configured');
  } finally {
    if (saved !== undefined) process.env.ORDER_CONFIRM_SECRET = saved;
  }
});

test('a token of the wrong kind is refused', () => {
  assert.throws(() => verifyScenes(forge({ ...fields, kind: 'order' }), deps), (e) => e.code === 'invalid_token');
  assert.throws(() => verifyScenes(forge({ ...fields }), deps), (e) => e.code === 'invalid_token');
});

test('an order-confirm token is refused', () => {
  const orderLike = forge({ orderNumber: 'FA-1234', email: 'a@b.co', names: 'Nova', total: '$60' });
  assert.throws(() => verifyScenes(orderLike, deps), (e) => e.code === 'invalid_token');
});

test('a signed story with the wrong number of scenes is refused', () => {
  assert.throws(() => verifyScenes(forge({ kind: 'scenes', ...fields, scenes: scenes.slice(2) }), deps), (e) => e.code === 'invalid_token');
});

test('a signed story with a mistyped field is refused', () => {
  for (const patch of [{ looks: 3 }, { age: null }, { title: [] }, { direction: '1' }]) {
    assert.throws(() => verifyScenes(forge({ kind: 'scenes', ...fields, ...patch }), deps), (e) => e.code === 'invalid_token', JSON.stringify(patch));
  }
});

test('tokenFieldsFor clamps exactly as the image prompts do', () => {
  const { LIMITS, clampField } = require('../lib/artPrompts');
  const book = { title: 'T'.repeat(500), direction: 2, data: { looks: 'a\nb', age: 7 } };
  const f = tokenFieldsFor(book, scenes);
  assert.strictEqual(f.title, clampField(book.title, LIMITS.title));
  assert.strictEqual(f.looks, 'a b');
  assert.strictEqual(f.age, '7');
  assert.strictEqual(f.direction, 2);
  assert.deepStrictEqual(f.scenes, scenes);
});

test('adoptSignedStory overwrites the client book with the signed fields', () => {
  const token = signScenes(fields, deps);
  const book = { audience: 'child', title: 'evil', direction: 0, scenes: ['x'], data: { name: 'Nova', looks: 'evil', age: '40' } };
  adoptSignedStory(book, token, deps);
  assert.deepStrictEqual(book.scenes, scenes);
  assert.strictEqual(book.title, fields.title);
  assert.strictEqual(book.direction, 1);
  assert.deepStrictEqual(book.data, { name: 'Nova', looks: 'curly hair', age: '7' });
});
