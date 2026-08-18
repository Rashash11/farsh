const test = require('node:test');
const assert = require('node:assert');

// genImage requires GEMINI_API_KEY to be set before it will call fetchFn at
// all (a fast-fail so a mis-configured deployment never makes a network
// call). These tests inject fetchFn as a full mock, so the key's value is
// irrelevant — but its presence is required to reach the mock. Set a dummy
// one here rather than depending on ambient environment/.env, which tests
// must not rely on.
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';

const { generateCoverArt, generatePlates } = require('../lib/generateArt');

// A 1x1 PNG, base64 — a valid image payload for the mock.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function okFetch() {
  let calls = 0;
  const fn = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }] } }] }),
  });
  return Object.assign((...a) => (calls++, fn(...a)), { get calls() { return calls; } });
}

const savedNames = [];
async function fakeSave(name, buf) { savedNames.push(name); return '/uploads/generated/' + name; }

const child = {
  audience: 'child', direction: 0, title: 'T',
  data: { name: 'Nova', age: '7', looks: 'curly hair' },
};

test('generateCoverArt returns sheet + cover URLs on success', async () => {
  const r = await generateCoverArt(child, { fetchFn: okFetch(), saveFn: fakeSave });
  assert.ok(r.characterSheetUrl.startsWith('/uploads/generated/'));
  assert.ok(r.coverUrl.startsWith('/uploads/generated/'));
  assert.strictEqual(r.usedPhoto, false);
});

test('photo refusal falls back to description sheet', async () => {
  let call = 0;
  const fetchFn = async () => {
    call++;
    if (call === 1) return { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] }) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }] } }] }) };
  };
  const r = await generateCoverArt({ ...child, photo: 'data:image/jpeg;base64,/9j/AAAA' }, { fetchFn, saveFn: fakeSave });
  assert.strictEqual(r.fellBackToDescription, true);
  assert.ok(r.characterSheetUrl); // description path succeeded
});

test('total failure yields nulls, never throws', async () => {
  const fetchFn = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const r = await generateCoverArt(child, { fetchFn, saveFn: fakeSave });
  assert.strictEqual(r.characterSheetUrl, null);
  assert.strictEqual(r.coverUrl, null);
});

test('generatePlates produces 6 slots with nulls for failures', async () => {
  let call = 0;
  const fetchFn = async () => {
    call++;
    if (call === 3) return { ok: false, status: 500, json: async () => ({}) }; // page 2 first try fails
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }] } }] }) };
  };
  const book = { ...child, characterSheetUrl: '/uploads/generated/sheet.png', scenes: ['a', 'b', 'c', 'd', 'e', 'f'] };
  // note: sheet must be fetchable — pass sheetBytes directly for tests
  const r = await generatePlates({ ...book, sheetBytesB64: PNG_B64 }, { fetchFn, saveFn: fakeSave });
  assert.strictEqual(r.plateUrls.length, 6);
  assert.ok(r.plateUrls.filter(Boolean).length >= 5);
});

// --- Review-fix coverage: malformed JSON, throwing saveFn, path traversal ---

test('malformed JSON on first attempt is treated as a transport failure and retries', async () => {
  let call = 0;
  const fetchFn = async () => {
    call++;
    if (call === 1) {
      // ok:true but the body is not valid JSON — res.json() throws.
      return { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token'); } };
    }
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }] } }] }) };
  };
  const r = await generateCoverArt(child, { fetchFn, saveFn: fakeSave });
  assert.ok(r.characterSheetUrl.startsWith('/uploads/generated/'));
  assert.ok(r.coverUrl.startsWith('/uploads/generated/'));
});

test('JSON parsing that always throws degrades to nulls, never throws', async () => {
  const fetchFn = async () => ({
    ok: true, status: 200,
    json: async () => { throw new SyntaxError('Unexpected token'); },
  });
  // If genImage let this exception escape, this await would reject and fail the test.
  const r = await generateCoverArt(child, { fetchFn, saveFn: fakeSave });
  assert.strictEqual(r.characterSheetUrl, null);
  assert.strictEqual(r.coverUrl, null);
});

test('a throwing saveFn degrades that slot to null, never throws', async () => {
  const throwingSave = async () => { throw new Error('blob upload failed'); };
  const r = await generateCoverArt(child, { fetchFn: okFetch(), saveFn: throwingSave });
  assert.strictEqual(r.characterSheetUrl, null);
  assert.strictEqual(r.coverUrl, null);
});

test('path traversal in characterSheetUrl is rejected, never throws', async () => {
  const book = { ...child, characterSheetUrl: '/../.env', scenes: ['a', 'b', 'c', 'd', 'e', 'f'] };
  const r = await generatePlates(book, { fetchFn: okFetch(), saveFn: fakeSave });
  assert.strictEqual(r.plateUrls.length, 6);
  assert.ok(r.plateUrls.every((u) => u === null));
});

test('path traversal to a file that actually exists outside uploads/generated is still rejected', async () => {
  // '.env' doesn't exist in this repo, so the traversal test above would
  // also pass against the OLD (unguarded) code by accident, via ENOENT
  // hitting the pre-existing catch-all. package.json at the repo root does
  // exist, so this is a real discriminator: unguarded code would have
  // successfully read and forwarded it; the containment check must reject
  // it before any read is attempted.
  const book = { ...child, characterSheetUrl: '/package.json', scenes: ['a', 'b', 'c', 'd', 'e', 'f'] };
  const r = await generatePlates(book, { fetchFn: okFetch(), saveFn: fakeSave });
  assert.ok(r.plateUrls.every((u) => u === null));
});
