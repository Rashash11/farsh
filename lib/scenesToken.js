// lib/scenesToken.js
//
// The art routes take a photo and a story and return photorealistic images
// of that face in that story. If any part of the story came straight from
// the client, that is a public face-swap service with our API key behind it:
// the scene lines say what happens, but `looks`, `age`, `title` and
// `direction` reach the very same prompt. So /api/generate-book signs every
// field that reaches the image model, and the art routes only illustrate a
// story that carries that signature — overwriting whatever the client sent
// with what was signed. Same stateless HMAC as the order-confirm link, same
// secret.

const { sign, verify } = require('./orderToken');
const { PAGE_COUNT } = require('./pageCount');
const { LIMITS, clampField } = require('./artPrompts');

// The two token types share a secret, so the payload says which one it is.
// Without the `kind` tag a token signed for one purpose could be replayed
// for the other and pass the signature check. verifyScenes refuses anything
// not tagged 'scenes', so an order-confirm token (untagged) never illustrates
// anything. The order-confirm reader (lib/confirmPayment.js) does not yet
// refuse a 'scenes'-tagged token; it should, for the same reason.
const KIND = 'scenes';

const isPageStrings = (a) =>
  Array.isArray(a) && a.length === PAGE_COUNT && a.every((s) => typeof s === 'string');

/**
 * @param {{scenes: string[], looks: string, age: string, title: string, direction: number}} fields
 * @returns {string} token
 * @throws .code 'invalid_scenes' (scenes are not PAGE_COUNT strings) | 'not_configured'
 */
function signScenes(fields, deps = {}) {
  const f = fields && typeof fields === 'object' ? fields : {};
  if (!isPageStrings(f.scenes)) {
    const err = new Error('invalid_scenes');
    err.code = 'invalid_scenes';
    throw err;
  }
  const direction = Number(f.direction);
  return sign({
    kind: KIND,
    scenes: f.scenes.map(String),
    looks: String(f.looks ?? ''),
    age: String(f.age ?? ''),
    title: String(f.title ?? ''),
    direction: Number.isFinite(direction) ? direction : 0,
  }, deps);
}

/**
 * @returns {{kind: 'scenes', scenes: string[], looks: string, age: string, title: string, direction: number}}
 * @throws .code 'invalid_token' | 'not_configured'
 */
function verifyScenes(token, deps = {}) {
  const t = verify(token, deps);
  const ok = t && typeof t === 'object' && t.kind === KIND && isPageStrings(t.scenes) &&
    typeof t.looks === 'string' && typeof t.age === 'string' && typeof t.title === 'string' &&
    typeof t.direction === 'number' && Number.isFinite(t.direction);
  if (!ok) {
    const err = new Error('invalid_scenes_token');
    err.code = 'invalid_token';
    throw err;
  }
  return t;
}

/**
 * What /api/generate-book signs: the book's own fields clamped by the SAME
 * limits lib/artPrompts.js applies when it builds the prompt, so the token
 * holds exactly what the image model will see — nothing longer slips in
 * between signing and drawing.
 */
function tokenFieldsFor(book, scenes) {
  const b = book && typeof book === 'object' ? book : {};
  const d = b.data && typeof b.data === 'object' ? b.data : {};
  return {
    scenes,
    looks: clampField(d.looks, LIMITS.looks),
    age: clampField(d.age, LIMITS.age),
    title: clampField(b.title, LIMITS.title),
    direction: b.direction,
  };
}

/**
 * Verifies `token` and overwrites every prompt-bearing field of `book` with
 * the signed values. Mutates and returns `book`. Throws like verifyScenes.
 */
function adoptSignedStory(book, token, deps = {}) {
  const t = verifyScenes(token, deps);
  const data = book.data && typeof book.data === 'object' ? book.data : {};
  book.scenes = t.scenes;
  book.data = { ...data, looks: t.looks, age: t.age };
  book.title = t.title;
  book.direction = t.direction;
  return book;
}

module.exports = { signScenes, verifyScenes, tokenFieldsFor, adoptSignedStory };
