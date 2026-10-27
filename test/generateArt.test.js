const test = require('node:test');
const assert = require('node:assert');

// genImage requires OPENAI_API_KEY to be set before it will call fetchFn at
// all. These tests inject fetchFn as a full mock, so the key's value is
// irrelevant — but its presence is required to reach the mock.
process.env.OPENAI_API_KEY = 'test-key';
delete process.env.OPENAI_IMAGE_MODEL;

const { generateCoverArt, generatePlates, redrawPlate, isOwnImageUrl } = require('../lib/generateArt');

// genImage logs every failed attempt for the operator. Many tests below fail
// on purpose, so the log is silenced for this file and captured explicitly
// where a test is about the log itself.
console.error = () => {};
async function captureErrors(fn) {
  const lines = [];
  const saved = console.error;
  console.error = (...args) => lines.push(args.join(' '));
  try { await fn(); } finally { console.error = saved; }
  return lines;
}
const { PAGE_COUNT } = require('../lib/pageCount');

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PHOTO = 'data:image/png;base64,' + PNG_B64;

const okBody = () => ({ created: 0, data: [{ b64_json: PNG_B64 }] });

// A moderation refusal is a 400 with a stable error code, unlike a
// transport failure; see the no-retry test below.
const refusal = () => ({
  ok: false, status: 400,
  text: async () => JSON.stringify({ error: { code: 'moderation_blocked', type: 'invalid_request_error', message: 'Your request was rejected by the safety system.' } }),
});

function okFetch() {
  const seen = [];
  const calls = [];
  const fn = async (url, opts) => {
    seen.push(JSON.parse(opts.body));
    calls.push({ url, headers: opts.headers });
    return { ok: true, status: 200, json: async () => okBody() };
  };
  return Object.assign(fn, { seen, calls });
}
// The reference images and the prompt, as the request carries them.
const refsOf = (body) => body.images.map((i) => i.image_url);
const promptOf = (body) => body.prompt;

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
  const body = fetchFn.seen[0];
  assert.match(refsOf(body)[0], /^data:image\/png;base64,/, 'photo must be the first reference');
  assert.ok(promptOf(body).includes('attached photograph'));
});

test('the call goes to the OpenAI edit endpoint with the bearer key, the model, and a portrait cover', async () => {
  const fetchFn = okFetch();
  await generateCoverArt(child, { fetchFn, saveFn: fakeSave });
  const { url, headers } = fetchFn.calls[0];
  assert.strictEqual(url, 'https://api.openai.com/v1/images/edits');
  assert.strictEqual(headers.Authorization, 'Bearer test-key');
  assert.ok(!url.includes('test-key'), 'the key never rides in the URL');
  const body = fetchFn.seen[0];
  assert.strictEqual(body.model, 'gpt-image-2.5-sunburst');
  assert.strictEqual(body.size, '1152x1536');
  assert.strictEqual(body.quality, 'high');
  assert.strictEqual(body.output_format, 'png');
  assert.strictEqual(body.n, 1);
});

test('OPENAI_IMAGE_MODEL overrides the model', async () => {
  process.env.OPENAI_IMAGE_MODEL = 'gpt-image-1.5';
  try {
    const fetchFn = okFetch();
    await generateCoverArt(child, { fetchFn, saveFn: fakeSave });
    assert.strictEqual(fetchFn.seen[0].model, 'gpt-image-1.5');
  } finally { delete process.env.OPENAI_IMAGE_MODEL; }
});

test('cover without a photo is not attempted', async () => {
  const fetchFn = okFetch();
  const r = await generateCoverArt({ ...child, photo: null }, { fetchFn, saveFn: fakeSave });
  assert.deepStrictEqual(r, { coverUrl: null, usedPhoto: false });
  assert.strictEqual(fetchFn.seen.length, 0);
});

test('a refused cover yields null, never throws, and is not retried', async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return refusal(); };
  const r = await generateCoverArt(child, { fetchFn, saveFn: fakeSave });
  assert.strictEqual(r.coverUrl, null);
  assert.strictEqual(calls, 1, 'a moderation refusal is deterministic; retrying it spends money on the same answer');
});

test('an answer with no image is null and not retried', async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return { ok: true, status: 200, json: async () => ({ data: [] }) }; };
  const r = await generateCoverArt(child, { fetchFn, saveFn: fakeSave });
  assert.strictEqual(r.coverUrl, null);
  assert.strictEqual(calls, 1);
});

test('plates: PAGE_COUNT slots, photo first, each scene clamped into its own prompt', async () => {
  const fetchFn = okFetch();
  const r = await generatePlates({ ...child, scenes }, { fetchFn, saveFn: fakeSave });
  assert.strictEqual(r.plateUrls.length, PAGE_COUNT);
  assert.ok(r.plateUrls.every((u) => u && u.startsWith('/uploads/generated/plate-')));
  r.plateUrls.forEach((u, i) => assert.match(u, new RegExp('plate-' + i + '-')));
  assert.strictEqual(fetchFn.seen.length, PAGE_COUNT);
  for (let i = 0; i < PAGE_COUNT; i++) {
    assert.match(refsOf(fetchFn.seen[i])[0], /^data:image\/png;base64,/, 'photo first on plate ' + i);
    assert.strictEqual(fetchFn.seen[i].size, '1024x1024', 'plates are square');
  }
  // Calls run concurrently, so check scenes by membership rather than by position.
  const texts = fetchFn.seen.map(promptOf);
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
    if (promptOf(JSON.parse(opts.body)).includes('scene 4')) {
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

// isOwnImageUrl reads the Blob configuration at call time; each test sets
// exactly the configuration it means and puts the old one back.
function withBlobEnv(env, fn) {
  const keys = ['BLOB_PUBLIC_HOST', 'BLOB_READ_WRITE_TOKEN'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  const restore = () => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
  let out;
  try { out = fn(); } catch (e) { restore(); throw e; }
  return out && typeof out.then === 'function' ? out.finally(restore) : (restore(), out);
}
const OUR_HOST = 'abc123xyz.public.blob.vercel-storage.com';

test('the cover is attached as a second reference only when it is our own URL', () => withBlobEnv({ BLOB_PUBLIC_HOST: OUR_HOST }, async () => {
  const own = okFetch();
  await generatePlates({ ...child, scenes, coverUrl: `https://${OUR_HOST}/farsh-art/cover-1.png` },
    { fetchFn: own, saveFn: fakeSave, fetchImage: async () => Buffer.from(PNG_B64, 'base64') });
  assert.strictEqual(refsOf(own.seen[0]).length, 2);
  assert.match(refsOf(own.seen[0])[1], /^data:image\/png;base64,/);

  const foreign = okFetch();
  let fetched = 0;
  await generatePlates({ ...child, scenes, coverUrl: 'https://evil.example.com/x.png' },
    { fetchFn: foreign, saveFn: fakeSave, fetchImage: async () => { fetched++; return Buffer.from(PNG_B64, 'base64'); } });
  assert.strictEqual(fetched, 0, 'must not fetch a foreign URL');
  assert.strictEqual(refsOf(foreign.seen[0]).length, 1);
}));

test('isOwnImageUrl accepts local generated paths and our pinned Blob host, nothing else', () => withBlobEnv({ BLOB_PUBLIC_HOST: OUR_HOST }, () => {
  assert.strictEqual(isOwnImageUrl('/uploads/generated/cover-1.png'), true);
  assert.strictEqual(isOwnImageUrl(`https://${OUR_HOST}/farsh-art/a.png`), true);
  assert.strictEqual(isOwnImageUrl(`http://${OUR_HOST}/farsh-art/a.png`), false);
  assert.strictEqual(isOwnImageUrl('/../.env'), false);
  assert.strictEqual(isOwnImageUrl('/package.json'), false);
  assert.strictEqual(isOwnImageUrl('https://evil.example.com/a.png'), false);
  assert.strictEqual(isOwnImageUrl(`https://${OUR_HOST}.evil.com/farsh-art/a.png`), false);
}));

test('another Blob store\'s host is not ours', () => withBlobEnv({ BLOB_PUBLIC_HOST: OUR_HOST }, () => {
  assert.strictEqual(isOwnImageUrl('https://someoneelse.public.blob.vercel-storage.com/farsh-art/a.png'), false);
}));

test('a URL on our host outside farsh-art/ is not ours', () => withBlobEnv({ BLOB_PUBLIC_HOST: OUR_HOST }, () => {
  assert.strictEqual(isOwnImageUrl(`https://${OUR_HOST}/farsh-orders/FA-1234.png`), false);
  assert.strictEqual(isOwnImageUrl(`https://${OUR_HOST}/a.png`), false);
  assert.strictEqual(isOwnImageUrl(`https://${OUR_HOST}/farsh-art`), false);
}));

test('without BLOB_PUBLIC_HOST the host is derived from the read-write token', () => withBlobEnv({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_AbC123XyZ_s3cretPart' }, () => {
  assert.strictEqual(isOwnImageUrl(`https://${OUR_HOST}/farsh-art/a.png`), true);
  assert.strictEqual(isOwnImageUrl('https://other.public.blob.vercel-storage.com/farsh-art/a.png'), false);
}));

test('BLOB_PUBLIC_HOST wins over the token', () => withBlobEnv({ BLOB_PUBLIC_HOST: 'pinned.public.blob.vercel-storage.com', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_AbC123XyZ_s3cretPart' }, () => {
  assert.strictEqual(isOwnImageUrl('https://pinned.public.blob.vercel-storage.com/farsh-art/a.png'), true);
  assert.strictEqual(isOwnImageUrl(`https://${OUR_HOST}/farsh-art/a.png`), false);
}));

test('with no Blob store configured, no https URL is ours', () => withBlobEnv({}, () => {
  assert.strictEqual(isOwnImageUrl(`https://${OUR_HOST}/farsh-art/a.png`), false);
  assert.strictEqual(isOwnImageUrl('/uploads/generated/plate-1.png'), true);
}));

test('redrawPlate clamps the index to the last page', async () => {
  const fetchFn = okFetch();
  const r = await redrawPlate({ ...child, scenes }, 99, { fetchFn, saveFn: fakeSave });
  assert.ok(r.plateUrl.startsWith('/uploads/generated/plate-' + (PAGE_COUNT - 1) + '-'));
  assert.ok(promptOf(fetchFn.seen[0]).includes('scene ' + (PAGE_COUNT - 1)));
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

test('a rejected call is logged for the operator with model, status and the API message', async () => {
  const fetchFn = async () => ({
    ok: false, status: 400,
    text: async () => JSON.stringify({ error: { code: 'invalid_api_key', message: 'Incorrect API key provided.' } }),
  });
  let r;
  const lines = await captureErrors(async () => { r = await generateCoverArt(child, { fetchFn, saveFn: fakeSave }); });
  assert.strictEqual(r.coverUrl, null);
  assert.strictEqual(lines.length, 2, 'one line per failed attempt: ' + lines.join(' | '));
  for (const l of lines) {
    assert.match(l, /^\[art\] /);
    assert.match(l, /gpt-image-2\.5-sunburst/);
    assert.match(l, /400/);
    assert.match(l, /Incorrect API key/);
    assert.ok(!/test-key/.test(l), 'the key must never be logged');
  }
});

test('a long error body is capped in the log', async () => {
  const fetchFn = async () => ({ ok: false, status: 500, text: async () => 'x'.repeat(5000) });
  const lines = await captureErrors(() => generateCoverArt(child, { fetchFn, saveFn: fakeSave }));
  assert.ok(lines.length > 0);
  for (const l of lines) assert.ok(l.length < 400, 'line was ' + l.length + ' chars');
});

test('a refusal logs its error code and the safety message', async () => {
  const a = await captureErrors(() => generateCoverArt(child, { fetchFn: async () => refusal(), saveFn: fakeSave }));
  assert.strictEqual(a.length, 1, a.join(' | '));
  assert.match(a[0], /\[art\].*refused.*moderation_blocked.*safety system/);
});

test('a thrown or aborted call logs the error name and message', async () => {
  const fetchFn = (url, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
  });
  const lines = await captureErrors(() => generateCoverArt(child, { fetchFn, saveFn: fakeSave, timeoutMs: 10 }));
  assert.strictEqual(lines.length, 2);
  for (const l of lines) assert.match(l, /\[art\].*AbortError: This operation was aborted/);
});

test('a log that cannot be written never breaks the call', async () => {
  const fetchFn = async () => ({ ok: false, status: 400, text: async () => { throw new Error('body gone'); } });
  const saved = console.error;
  console.error = () => { throw new Error('log sink down'); };
  try {
    const r = await generateCoverArt(child, { fetchFn, saveFn: fakeSave });
    assert.strictEqual(r.coverUrl, null);
  } finally { console.error = saved; }
});

test('plates: with a deadline of 0 nothing starts and every slot is null', async () => {
  const fetchFn = okFetch();
  const r = await generatePlates({ ...child, scenes }, { fetchFn, saveFn: fakeSave, deadlineMs: 0 });
  assert.strictEqual(r.plateUrls.length, PAGE_COUNT);
  assert.ok(r.plateUrls.every((u) => u === null));
  assert.strictEqual(fetchFn.seen.length, 0);
});

test('plates: once the deadline passes no new slot starts, and running ones finish', async () => {
  const slow = async () => {
    await new Promise((r) => setTimeout(r, 80));
    return { ok: true, status: 200, json: async () => okBody() };
  };
  let calls = 0;
  const fetchFn = async (...a) => { calls++; return slow(...a); };
  const r = await generatePlates({ ...child, scenes }, { fetchFn, saveFn: fakeSave, concurrency: 3, deadlineMs: 30 });
  assert.strictEqual(r.plateUrls.length, PAGE_COUNT);
  assert.strictEqual(calls, 3);
  r.plateUrls.forEach((u, i) => (i < 3 ? assert.ok(u, 'slot ' + i) : assert.strictEqual(u, null, 'slot ' + i)));
});
