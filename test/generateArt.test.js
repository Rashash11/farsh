const test = require('node:test');
const assert = require('node:assert');

// genImage requires GEMINI_API_KEY to be set before it will call fetchFn at
// all. These tests inject fetchFn as a full mock, so the key's value is
// irrelevant — but its presence is required to reach the mock.
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';

const { generateCoverArt, generatePlates, redrawPlate, isOwnImageUrl } = require('../lib/generateArt');
const { PAGE_COUNT } = require('../lib/pageCount');

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PHOTO = 'data:image/png;base64,' + PNG_B64;

const okBody = () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }] } }] });

function okFetch() {
  const seen = [];
  const fn = async (url, opts) => {
    seen.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => okBody() };
  };
  return Object.assign(fn, { seen });
}

async function fakeSave(name) { return '/uploads/generated/' + name; }

const scenes = Array.from({ length: PAGE_COUNT }, (_, i) => 'scene ' + i);
const child = {
  audience: 'child', direction: 0, title: 'T', photo: PHOTO,
  data: { name: 'Nova', age: '7', looks: 'curly hair' },
};

test('the sheet code is gone', () => {
  const mod = require('../lib/generateArt');
  assert.strictEqual(mod.sheetPartFor, undefined);
});

test('cover is generated from the photo as the first reference part', async () => {
  const fetchFn = okFetch();
  const r = await generateCoverArt(child, { fetchFn, saveFn: fakeSave });
  assert.ok(r.coverUrl.startsWith('/uploads/generated/cover-'));
  assert.strictEqual(r.usedPhoto, true);
  assert.strictEqual(fetchFn.seen.length, 1);
  const parts = fetchFn.seen[0].contents[0].parts;
  assert.ok(parts[0].inline_data, 'photo must be the first part');
  assert.strictEqual(parts[parts.length - 1].text.includes('attached photograph'), true);
});

test('cover without a photo is not attempted', async () => {
  const fetchFn = okFetch();
  const r = await generateCoverArt({ ...child, photo: null }, { fetchFn, saveFn: fakeSave });
  assert.deepStrictEqual(r, { coverUrl: null, usedPhoto: false });
  assert.strictEqual(fetchFn.seen.length, 0);
});

test('a refused cover yields null and never throws', async () => {
  const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] }) });
  const r = await generateCoverArt(child, { fetchFn, saveFn: fakeSave });
  assert.strictEqual(r.coverUrl, null);
});

test('plates: PAGE_COUNT slots, photo first, each scene clamped into its own prompt', async () => {
  const fetchFn = okFetch();
  const r = await generatePlates({ ...child, scenes }, { fetchFn, saveFn: fakeSave });
  assert.strictEqual(r.plateUrls.length, PAGE_COUNT);
  assert.ok(r.plateUrls.every((u) => u && u.startsWith('/uploads/generated/plate-')));
  r.plateUrls.forEach((u, i) => assert.match(u, new RegExp('plate-' + i + '-')));
  assert.strictEqual(fetchFn.seen.length, PAGE_COUNT);
  for (let i = 0; i < PAGE_COUNT; i++) {
    assert.ok(fetchFn.seen[i].contents[0].parts[0].inline_data, 'photo first on plate ' + i);
  }
  // Calls run concurrently, so check scenes by membership rather than by position.
  const texts = fetchFn.seen.map((b) => b.contents[0].parts.at(-1).text);
  for (let i = 0; i < PAGE_COUNT; i++) assert.ok(texts.some((t) => t.includes('scene ' + i)), 'missing scene ' + i);
});

test('plates without a photo are all null and make no calls', async () => {
  const fetchFn = okFetch();
  const r = await generatePlates({ ...child, photo: null, scenes }, { fetchFn, saveFn: fakeSave });
  assert.ok(r.plateUrls.every((u) => u === null));
  assert.strictEqual(fetchFn.seen.length, 0);
});

test('a failed slot is null, the others still succeed', async () => {
  // Fail every attempt (including the retry) for scene 4 only.
  const fetchFn = async (url, opts) => {
    if (JSON.parse(opts.body).contents[0].parts.at(-1).text.includes('scene 4')) {
      return { ok: false, status: 500, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => okBody() };
  };
  const r = await generatePlates({ ...child, scenes }, { fetchFn, saveFn: fakeSave });
  assert.strictEqual(r.plateUrls.length, PAGE_COUNT);
  assert.strictEqual(r.plateUrls[4], null);
  r.plateUrls.forEach((u, i) => { if (i !== 4) assert.ok(u, 'slot ' + i); });
});

test('no more than `concurrency` image calls are in flight at once', async () => {
  let inFlight = 0, peak = 0;
  const fetchFn = async () => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return { ok: true, status: 200, json: async () => okBody() };
  };
  await generatePlates({ ...child, scenes }, { fetchFn, saveFn: fakeSave, concurrency: 3 });
  assert.ok(peak <= 3, 'peak was ' + peak);
  assert.ok(peak >= 2, 'expected some parallelism, peak was ' + peak);
});

test('a hung call is aborted after timeoutMs and the slot is null', async () => {
  const fetchFn = (url, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const started = Date.now();
  const r = await generateCoverArt(child, { fetchFn, saveFn: fakeSave, timeoutMs: 30 });
  assert.strictEqual(r.coverUrl, null);
  assert.ok(Date.now() - started < 2000);
});

test('a 429 waits backoffMs before the retry instead of retrying at once', async () => {
  const times = [];
  const fetchFn = async () => {
    times.push(Date.now());
    if (times.length === 1) return { ok: false, status: 429, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => okBody() };
  };
  const r = await generateCoverArt(child, { fetchFn, saveFn: fakeSave, backoffMs: 40 });
  assert.ok(r.coverUrl);
  assert.ok(times[1] - times[0] >= 35, 'retried after ' + (times[1] - times[0]) + 'ms');
});

test('the cover is attached as a second reference only when it is our own URL', async () => {
  const own = okFetch();
  await generatePlates({ ...child, scenes, coverUrl: 'https://abc.public.blob.vercel-storage.com/farsh-art/cover-1.png' },
    { fetchFn: own, saveFn: fakeSave, fetchImage: async () => Buffer.from(PNG_B64, 'base64') });
  assert.strictEqual(own.seen[0].contents[0].parts.filter((p) => p.inline_data).length, 2);

  const foreign = okFetch();
  let fetched = 0;
  await generatePlates({ ...child, scenes, coverUrl: 'https://evil.example.com/x.png' },
    { fetchFn: foreign, saveFn: fakeSave, fetchImage: async () => { fetched++; return Buffer.from(PNG_B64, 'base64'); } });
  assert.strictEqual(fetched, 0, 'must not fetch a foreign URL');
  assert.strictEqual(foreign.seen[0].contents[0].parts.filter((p) => p.inline_data).length, 1);
});

test('isOwnImageUrl accepts local generated paths and the Blob host, nothing else', () => {
  assert.strictEqual(isOwnImageUrl('/uploads/generated/cover-1.png'), true);
  assert.strictEqual(isOwnImageUrl('https://x.public.blob.vercel-storage.com/farsh-art/a.png'), true);
  assert.strictEqual(isOwnImageUrl('http://x.public.blob.vercel-storage.com/a.png'), false);
  assert.strictEqual(isOwnImageUrl('/../.env'), false);
  assert.strictEqual(isOwnImageUrl('/package.json'), false);
  assert.strictEqual(isOwnImageUrl('https://evil.example.com/a.png'), false);
  assert.strictEqual(isOwnImageUrl('https://x.public.blob.vercel-storage.com.evil.com/a.png'), false);
});

test('redrawPlate clamps the index to the last page', async () => {
  const fetchFn = okFetch();
  const r = await redrawPlate({ ...child, scenes }, 99, { fetchFn, saveFn: fakeSave });
  assert.ok(r.plateUrl.startsWith('/uploads/generated/plate-' + (PAGE_COUNT - 1) + '-'));
  assert.ok(fetchFn.seen[0].contents[0].parts.at(-1).text.includes('scene ' + (PAGE_COUNT - 1)));
});

test('a throwing saveFn degrades that slot to null, never throws', async () => {
  const throwingSave = async () => { throw new Error('blob upload failed'); };
  const r = await generateCoverArt(child, { fetchFn: okFetch(), saveFn: throwingSave });
  assert.strictEqual(r.coverUrl, null);
});

test('a malformed book never throws and still yields PAGE_COUNT slots', async () => {
  const bad = Array.from({ length: PAGE_COUNT }, (_, i) => (i % 2 ? 42 : null));
  const r = await generatePlates({ ...child, data: null, scenes: bad }, { fetchFn: okFetch(), saveFn: fakeSave });
  assert.strictEqual(r.plateUrls.length, PAGE_COUNT);
  const c = await generateCoverArt({ ...child, data: null }, { fetchFn: okFetch(), saveFn: fakeSave });
  assert.ok('coverUrl' in c);
  const p = await redrawPlate({ ...child, data: null, scenes: bad }, 1, { fetchFn: okFetch(), saveFn: fakeSave });
  assert.ok('plateUrl' in p);
});
