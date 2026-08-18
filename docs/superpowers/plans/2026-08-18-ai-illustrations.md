# AI Illustrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate real character sheets, cover art, and 6 story-plate illustrations per personalized book via the Gemini image API, stored in Vercel Blob, wired into the existing Builder → Preview → Checkout flow.

**Architecture:** A new dependency-light `lib/generateArt.js` (pure prompt builders + a Gemini REST client using Node's built-in fetch) mirrors how `lib/generateBook.js` works today. Three new endpoints follow the existing server.js + `api/` serverless-twin pattern. Story generation gains a per-page `scene` line (same Claude call). The frontend stores only URLs; the uploaded photo is downscaled client-side (canvas re-encode also strips EXIF) and never persisted server-side.

**Tech Stack:** Node ≥18 (built-in `fetch`, `node --test`), Express 5, `@vercel/blob` (only new dependency), Gemini image API via REST (no SDK), dc-runtime frontend pages.

**Spec:** `docs/superpowers/specs/2026-08-18-ai-illustrations-design.md`

## Global Constraints

- Node ≥18, CommonJS (`"type": "commonjs"`), match existing code style (this repo uses semicolons).
- Only new npm dependency allowed: `@vercel/blob`. Gemini is called with plain `fetch`; tests use built-in `node --test`.
- Every image prompt must end with the CONSTRAINTS block: "Painted storybook illustration only — never photorealistic. No text, letters, numbers, borders, or watermarks in the image. Single coherent scene."
- Uploaded photos: memory only, never written to Blob/disk/logs, EXIF-stripped, discarded after the character-sheet call.
- Any image failure falls back to today's stock plates / typeset cover for that slot only. The book must always render.
- Rate limiting: image endpoints use a stricter bucket (per-IP 3/10min, global 30/hour) via the extended `checkRateLimit`.
- Env vars: `GEMINI_API_KEY` (required for art), `GEMINI_IMAGE_MODEL` (optional, default `gemini-2.5-flash-image`), `BLOB_READ_WRITE_TOKEN` (required on Vercel; locally falls back to writing `uploads/generated/`).
- Frontends read `book.pages` as an array of plain strings — that contract must not break.

---

### Task 1: Test infra + EXIF stripper

**Files:**
- Create: `lib/stripExif.js`
- Create: `test/stripExif.test.js`
- Modify: `package.json` (add test script)

**Interfaces:**
- Produces: `stripExif(buffer: Buffer) -> Buffer` — returns a JPEG buffer with APP1/APP2 (EXIF/ICC-adjacent metadata) segments removed; non-JPEG buffers are returned unchanged.

- [ ] **Step 1: Add the test script to package.json**

In `package.json` `"scripts"`, add:

```json
"test": "node --test test/"
```

- [ ] **Step 2: Write the failing test**

Create `test/stripExif.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { stripExif } = require('../lib/stripExif');

// Build a minimal fake JPEG: SOI, APP1 (Exif) segment, DQT segment, EOI.
function fakeJpegWithExif() {
  const soi = Buffer.from([0xff, 0xd8]);
  const exifBody = Buffer.from('Exif\0\0fakemetadata');
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1]),
    Buffer.from([(exifBody.length + 2) >> 8, (exifBody.length + 2) & 0xff]),
    exifBody,
  ]);
  const dqtBody = Buffer.from([0x00, 0x01, 0x02]);
  const dqt = Buffer.concat([
    Buffer.from([0xff, 0xdb]),
    Buffer.from([(dqtBody.length + 2) >> 8, (dqtBody.length + 2) & 0xff]),
    dqtBody,
  ]);
  const eoi = Buffer.from([0xff, 0xd9]);
  return { full: Buffer.concat([soi, app1, dqt, eoi]), withoutApp1: Buffer.concat([soi, dqt, eoi]) };
}

test('removes APP1 segment from a JPEG', () => {
  const { full, withoutApp1 } = fakeJpegWithExif();
  assert.deepStrictEqual(stripExif(full), withoutApp1);
});

test('returns non-JPEG buffers unchanged', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  assert.deepStrictEqual(stripExif(png), png);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../lib/stripExif'"

- [ ] **Step 4: Write the implementation**

Create `lib/stripExif.js`:

```js
// Removes EXIF-class metadata (APP1/APP2 segments) from a JPEG buffer.
// Defense-in-depth: the client already re-encodes photos via <canvas>
// (which drops EXIF), but the server must not rely on the client.

function stripExif(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    return buf; // not a JPEG — leave untouched
  }
  const out = [Buffer.from([0xff, 0xd8])];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) break; // malformed — keep the rest as-is
    const marker = buf[i + 1];
    if (marker === 0xd9 || marker === 0xda) {
      // EOI or start-of-scan: copy everything remaining verbatim
      out.push(buf.subarray(i));
      i = buf.length;
      break;
    }
    const segLen = buf.readUInt16BE(i + 2);
    const seg = buf.subarray(i, i + 2 + segLen);
    if (marker !== 0xe1 && marker !== 0xe2) out.push(seg); // drop APP1/APP2
    i += 2 + segLen;
  }
  if (i < buf.length) out.push(buf.subarray(i));
  return Buffer.concat(out);
}

module.exports = { stripExif };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json lib/stripExif.js test/stripExif.test.js
git commit -m "Add node --test infra and JPEG EXIF stripper"
```

---

### Task 2: Story generation emits a scene brief per page

**Files:**
- Modify: `lib/generateBook.js`
- Modify: `server.js:30-62` (generate-book route)
- Modify: `api/generate-book.js`
- Create: `test/generateBook.test.js`

**Interfaces:**
- Consumes: existing `buildPrompt(book)`, `CHAPTER_BEATS`.
- Produces: `generateBookPages(book, apiKey) -> Promise<{pages: string[6], scenes: string[6]}>` (was `string[6]`). New exported pure helper `normalizePages(parsed) -> {pages, scenes}`. HTTP response shape becomes `{pages, scenes}` — `pages` stays a plain string array so existing frontend code keeps working.

- [ ] **Step 1: Write the failing tests**

Create `test/generateBook.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { buildPrompt, normalizePages } = require('../lib/generateBook');

test('buildPrompt asks for a scene per page', () => {
  const p = buildPrompt({ audience: 'child', names: 'Nova', data: { name: 'Nova' } });
  assert.match(p, /scene/i);
  assert.match(p, /"scene"/); // the JSON field name is spelled out
});

test('normalizePages splits objects into pages and scenes, padded to 6', () => {
  const parsed = { pages: [
    { text: 'One.', scene: 'a door' },
    { text: 'Two.', scene: 'a dragon' },
  ] };
  const { pages, scenes } = normalizePages(parsed);
  assert.strictEqual(pages.length, 6);
  assert.strictEqual(scenes.length, 6);
  assert.strictEqual(pages[0], 'One.');
  assert.strictEqual(scenes[1], 'a dragon');
  assert.strictEqual(pages[5], 'Two.'); // padded by repeating last
});

test('normalizePages tolerates legacy plain-string pages', () => {
  const { pages, scenes } = normalizePages({ pages: ['A.', 'B.'] });
  assert.strictEqual(pages[0], 'A.');
  assert.strictEqual(scenes[0], ''); // no scene available
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `normalizePages` is not exported; buildPrompt has no scene wording.

- [ ] **Step 3: Implement**

In `lib/generateBook.js`:

1. Append to the prompt string in `buildPrompt` (after the "Style:" paragraph):

```
For each page also write a "scene": one vivid sentence describing a single
illustratable moment from that page — concrete subject, action, setting,
lighting. No style words (the illustrator adds those), no character names
in the scene line (say "the child" / "the couple" / "the family").
```

2. Replace `PAGES_SCHEMA` with:

```js
const PAGES_SCHEMA = {
  type: 'object',
  properties: {
    pages: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, scene: { type: 'string' } },
        required: ['text', 'scene'],
        additionalProperties: false,
      },
    },
  },
  required: ['pages'],
  additionalProperties: false,
};
```

3. Add and export `normalizePages`; use it at the end of `generateBookPages`:

```js
function normalizePages(parsed) {
  let items = Array.isArray(parsed.pages) ? parsed.pages : [];
  items = items
    .map((p) => (typeof p === 'string' ? { text: p, scene: '' } : p))
    .filter((p) => p && typeof p.text === 'string' && p.text.trim());
  if (items.length === 0) throw new Error('empty_pages');
  if (items.length > 6) items = items.slice(0, 6);
  while (items.length < 6) items.push(items[items.length - 1]);
  return {
    pages: items.map((p) => p.text),
    scenes: items.map((p) => (typeof p.scene === 'string' ? p.scene : '')),
  };
}
```

`generateBookPages` now ends with `return normalizePages(parsed);` and its JSDoc return type becomes `Promise<{pages: string[], scenes: string[]}>`. Export `normalizePages` in `module.exports`.

4. In `server.js` route and `api/generate-book.js`: change

```js
const pages = await generateBookPages(book, process.env.ANTHROPIC_API_KEY);
res.json({ pages });
```

to

```js
const { pages, scenes } = await generateBookPages(book, process.env.ANTHROPIC_API_KEY);
res.json({ pages, scenes });
```

(In `api/generate-book.js` it's `res.status(200).json({ pages, scenes });`.)

5. In `Book Preview.dc.html` `generate()` (~line 356): after the existing `pages` handling, also store scenes:

```js
const updated = { ...book, pages: json.pages, scenes: Array.isArray(json.scenes) ? json.scenes : [], pagesFor: fp };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add lib/generateBook.js server.js api/generate-book.js "Book Preview.dc.html" test/generateBook.test.js
git commit -m "Story generation also emits a one-line scene brief per page"
```

---

### Task 3: Art prompt builders + visual fingerprint (pure functions)

**Files:**
- Create: `lib/artPrompts.js`
- Create: `test/artPrompts.test.js`

**Interfaces:**
- Produces (all pure, all exported):
  - `STYLE_BLOCKS: {child: {0,1,2}, couple: {0,1,2}, family: {0,1,2}}` — style text per audience+direction index.
  - `CONSTRAINTS: string` — the mandatory closing block.
  - `characterSheetPrompt(book) -> string`
  - `photoSheetPrompt(book) -> string` (prompt to accompany attached photo(s))
  - `platePrompt(book, scene) -> string`
  - `coverPrompt(book) -> string`
  - `artFingerprint(book) -> string`

- [ ] **Step 1: Write the failing tests**

Create `test/artPrompts.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const {
  STYLE_BLOCKS, CONSTRAINTS,
  characterSheetPrompt, photoSheetPrompt, platePrompt, coverPrompt,
  artFingerprint,
} = require('../lib/artPrompts');

const child = {
  audience: 'child', direction: 0, title: 'Nova and the door',
  data: { name: 'Nova', age: '7', looks: 'curly dark hair, round glasses' },
};

test('every audience/direction has a style block', () => {
  for (const aud of ['child', 'couple', 'family']) {
    for (const d of [0, 1, 2]) assert.ok(STYLE_BLOCKS[aud][d].length > 40, aud + d);
  }
});

test('all prompts end with the constraints block', () => {
  for (const p of [characterSheetPrompt(child), photoSheetPrompt(child),
                   platePrompt(child, 'the child opens a green door'), coverPrompt(child)]) {
    assert.ok(p.trim().endsWith(CONSTRAINTS), p.slice(-120));
  }
});

test('character sheet includes looks and age, never the name', () => {
  const p = characterSheetPrompt(child);
  assert.match(p, /curly dark hair/);
  assert.match(p, /7-year-old/);
  assert.ok(!p.includes('Nova')); // names are typeset, not painted
});

test('plate prompt includes the scene and reference-sheet instruction', () => {
  const p = platePrompt(child, 'the child opens a green door');
  assert.match(p, /green door/);
  assert.match(p, /reference sheet/i);
  assert.match(p, /4:3/);
});

test('cover prompt is portrait with calm top third', () => {
  const p = coverPrompt(child);
  assert.match(p, /3:4/);
  assert.match(p, /top third/i);
});

test('artFingerprint ignores name, changes with looks/direction/photo', () => {
  const fp = artFingerprint(child);
  assert.strictEqual(fp, artFingerprint({ ...child, data: { ...child.data, name: 'Zeus' } }));
  assert.notStrictEqual(fp, artFingerprint({ ...child, direction: 1 }));
  assert.notStrictEqual(fp, artFingerprint({ ...child, data: { ...child.data, looks: 'red hair' } }));
  assert.notStrictEqual(fp, artFingerprint({ ...child, photo: 'data:image/jpeg;base64,AAAA' }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/artPrompts.js`:

```js
// Pure prompt builders for book illustrations. No network, no state —
// everything here is snapshot-testable. Style blocks are versioned by
// being literal strings: change one and the artFingerprint stays the
// same on purpose (style tweaks should not invalidate every cached book).

const CONSTRAINTS =
  'Painted storybook illustration only — never photorealistic. No text, ' +
  'letters, numbers, borders, or watermarks in the image. Single coherent scene.';

const BASE_MEDIUM =
  'painted storybook illustration, gouache and colored-pencil texture, ' +
  'visible brushwork, classic 1970s Scholastic paperback feel';

const STYLE_BLOCKS = {
  child: {
    0: `Midnight Magic style: ${BASE_MEDIUM}, ink-dark night palette with deep blues, glowing warm lantern light, twinkling stars, dreamlike and quiet.`,
    1: `Scrapbook style: ${BASE_MEDIUM}, cut-paper and tape collage accents, handmade craft feel, warm kraft-paper tones with bright sticker colors.`,
    2: `Toybox style: ${BASE_MEDIUM}, loud saturated primary colors, round friendly shapes, everything in joyful motion.`,
  },
  couple: {
    0: `Midnight Velvet style: ${BASE_MEDIUM}, deep quiet palette of wine and midnight blue, intimate low light, very few elements per scene.`,
    1: `Letter Press style: ${BASE_MEDIUM}, vintage letterpress texture on thick cream paper, muted inks, classical and nostalgic.`,
    2: `Paper Garden style: ${BASE_MEDIUM}, botanical margins, soft floral colors, lots of white space, delicate organic shapes.`,
  },
  family: {
    0: `Kitchen Table style: ${BASE_MEDIUM}, warm domestic light, handwriting-adjacent looseness, everyone mid-conversation.`,
    1: `The Album style: ${BASE_MEDIUM}, composed like mounted photographs with painted captions-space, sepia-warmed colors.`,
    2: `Long Table style: ${BASE_MEDIUM}, wide tableaus like places set for dinner, earthy welcoming palette.`,
  },
};

function styleFor(book) {
  const aud = ['child', 'couple', 'family'].includes(book.audience) ? book.audience : 'child';
  const dir = [0, 1, 2].includes(book.direction) ? book.direction : 0;
  return STYLE_BLOCKS[aud][dir];
}

function subjectFor(book) {
  const d = (book.data && typeof book.data === 'object') ? book.data : {};
  if (book.audience === 'couple') {
    return `two adults, a couple${d.met ? ` (how they met: ${d.met})` : ''}. Warm, understated, never saccharine.`;
  }
  if (book.audience === 'family') {
    return `a family${d.members ? `: ${d.members}` : ''}. Group scenes, everyone distinct and consistent.`;
  }
  const age = d.age ? `${d.age}-year-old` : 'young';
  const looks = d.looks ? `, ${d.looks}` : '';
  return `a ${age} child${looks}. Cheerful, expressive face. Simple timeless clothes.`;
}

function characterSheetPrompt(book) {
  return `Character reference sheet, ${styleFor(book)}
Character(s): ${subjectFor(book)}
Show the SAME character(s) 4 times on one sheet: front view, side view, mid-action pose, expressive close-up. Plain cream background.
${CONSTRAINTS}`;
}

function photoSheetPrompt(book) {
  return `Transform the person in the attached photo into a painted storybook character: preserve hair style and color, skin tone, and glasses if present. Fully illustrated with gouache texture — not a photo filter.
${styleFor(book)}
Same 4-pose reference sheet layout: front view, side view, mid-action pose, expressive close-up. Plain cream background.
${CONSTRAINTS}`;
}

function platePrompt(book, scene) {
  return `Using the attached character reference sheet, illustrate this exact character (same face, hair, glasses, clothes) in a new scene.
Scene: ${scene || 'a quiet, warm moment from the story'}.
${styleFor(book)}
Landscape 4:3 composition.
${CONSTRAINTS}`;
}

function coverPrompt(book) {
  return `Using the attached character reference sheet, paint a book COVER illustration of this exact character.
The scene should evoke the book's title: "${book.title || 'an adventure'}" — but paint NO title text.
${styleFor(book)}
Portrait 3:4 composition; keep the top third calm and uncluttered (a title is typeset over it later).
${CONSTRAINTS}`;
}

// djb2 — tiny, stable, dependency-free.
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function artFingerprint(book) {
  const d = (book.data && typeof book.data === 'object') ? book.data : {};
  return JSON.stringify({
    audience: book.audience, direction: book.direction || 0,
    looks: d.looks || '', age: d.age || '', members: d.members || '',
    photo: book.photo ? hashStr(book.photo) : (Array.isArray(book.photos) ? book.photos.map(hashStr) : ''),
  });
}

module.exports = {
  STYLE_BLOCKS, CONSTRAINTS,
  characterSheetPrompt, photoSheetPrompt, platePrompt, coverPrompt,
  artFingerprint,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/artPrompts.js test/artPrompts.test.js
git commit -m "Art prompt builders and visual fingerprint (pure, tested)"
```

---

### Task 4: Gemini client + storage + fallback pipeline

**Files:**
- Create: `lib/generateArt.js`
- Create: `test/generateArt.test.js`
- Modify: `package.json` (add `@vercel/blob`)

**Interfaces:**
- Consumes: `lib/artPrompts.js` builders; `lib/stripExif.js`.
- Produces:
  - `generateCoverArt(book, deps?) -> Promise<{characterSheetUrl: string|null, coverUrl: string|null, usedPhoto: boolean, fellBackToDescription: boolean}>`
  - `generatePlates(book, deps?) -> Promise<{plateUrls: (string|null)[6]}>` — requires `book.characterSheetUrl` and `book.scenes`.
  - `redrawPlate(book, pageIndex, deps?) -> Promise<{plateUrl: string|null}>`
  - `deps` (all optional, for tests): `{fetchFn, saveFn, now}`. Default `saveFn` = Blob when `BLOB_READ_WRITE_TOKEN` set, else write `uploads/generated/<id>.png` and return `/uploads/generated/<id>.png`.

- [ ] **Step 1: Install the dependency**

Run: `npm install @vercel/blob`

- [ ] **Step 2: Write the failing tests**

Create `test/generateArt.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `lib/generateArt.js`:

```js
// Gemini image pipeline: character sheet -> cover -> plates.
// Plain fetch against the REST API (no SDK). All failures degrade to
// null URLs — callers treat null as "keep the stock art for this slot".

const crypto = require('crypto');
const { stripExif } = require('./stripExif');
const {
  characterSheetPrompt, photoSheetPrompt, platePrompt, coverPrompt,
} = require('./artPrompts');

const MODEL = () => process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const API = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPG_MAGIC = Buffer.from([0xff, 0xd8]);

function looksLikeImage(buf) {
  return buf.length > 1000 &&
    (buf.subarray(0, 4).equals(PNG_MAGIC) || buf.subarray(0, 2).equals(JPG_MAGIC));
}

function dataUrlToPart(dataUrl) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  let buf = Buffer.from(m[2], 'base64');
  if (m[1] === 'image/jpeg') buf = stripExif(buf);
  return { inline_data: { mime_type: m[1], data: buf.toString('base64') } };
}

async function defaultSave(name, buf) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = require('@vercel/blob');
    const { url } = await put(`farsh-art/${name}`, buf, { access: 'public', contentType: 'image/png' });
    return url;
  }
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'uploads', 'generated');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), buf);
  return `/uploads/generated/${name}`;
}

// One Gemini call -> Buffer or null. Retries once. Never throws.
async function genImage(prompt, refParts, { fetchFn }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const doFetch = fetchFn || fetch;
  const body = JSON.stringify({
    contents: [{ parts: [...(refParts || []), { text: prompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await doFetch(API(MODEL(), key), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      });
      if (!res.ok) continue;
      const json = await res.json();
      const parts = json.candidates && json.candidates[0] &&
        json.candidates[0].content && json.candidates[0].content.parts || [];
      const img = parts.find((p) => p.inlineData && p.inlineData.data);
      if (!img) continue; // refusal / text-only answer
      const buf = Buffer.from(img.inlineData.data, 'base64');
      if (looksLikeImage(buf)) return buf;
    } catch (e) { /* network error -> retry / give up */ }
  }
  return null;
}

function id() { return crypto.randomBytes(8).toString('hex'); }

async function generateCoverArt(book, deps = {}) {
  const save = deps.saveFn || defaultSave;
  const photos = book.photos || (book.photo ? [book.photo] : []);
  const photoParts = photos.map(dataUrlToPart).filter(Boolean);
  let usedPhoto = false, fellBackToDescription = false, sheetBuf = null;

  if (photoParts.length) {
    sheetBuf = await genImage(photoSheetPrompt(book), photoParts, deps);
    if (sheetBuf) usedPhoto = true;
    else fellBackToDescription = true;
  }
  if (!sheetBuf) sheetBuf = await genImage(characterSheetPrompt(book), [], deps);
  if (!sheetBuf) return { characterSheetUrl: null, coverUrl: null, usedPhoto: false, fellBackToDescription };

  const sheetPart = { inline_data: { mime_type: 'image/png', data: sheetBuf.toString('base64') } };
  const coverBuf = await genImage(coverPrompt(book), [sheetPart], deps);

  const characterSheetUrl = await save(`sheet-${id()}.png`, sheetBuf);
  const coverUrl = coverBuf ? await save(`cover-${id()}.png`, coverBuf) : null;
  return { characterSheetUrl, coverUrl, usedPhoto, fellBackToDescription };
}

async function sheetPartFor(book, deps) {
  if (book.sheetBytesB64) { // test/short-circuit path
    return { inline_data: { mime_type: 'image/png', data: book.sheetBytesB64 } };
  }
  if (!book.characterSheetUrl) return null;
  try {
    const doFetch = (deps && deps.fetchFn) || fetch;
    // Local-relative URLs can't be fetched from the server; only absolute Blob URLs.
    if (!/^https?:/.test(book.characterSheetUrl)) {
      const fs = require('fs'); const path = require('path');
      const p = path.join(__dirname, '..', book.characterSheetUrl.replace(/^\//, ''));
      return { inline_data: { mime_type: 'image/png', data: fs.readFileSync(p).toString('base64') } };
    }
    const res = await doFetch(book.characterSheetUrl);
    const buf = Buffer.from(await res.arrayBuffer());
    return { inline_data: { mime_type: 'image/png', data: buf.toString('base64') } };
  } catch (e) { return null; }
}

async function generatePlates(book, deps = {}) {
  const save = deps.saveFn || defaultSave;
  const sheetPart = await sheetPartFor(book, deps);
  const scenes = Array.isArray(book.scenes) ? book.scenes : [];
  const plateUrls = [];
  for (let i = 0; i < 6; i++) {
    if (!sheetPart) { plateUrls.push(null); continue; }
    const buf = await genImage(platePrompt(book, scenes[i]), [sheetPart], deps);
    plateUrls.push(buf ? await save(`plate-${i}-${id()}.png`, buf) : null);
  }
  return { plateUrls };
}

async function redrawPlate(book, pageIndex, deps = {}) {
  const save = deps.saveFn || defaultSave;
  const i = Math.max(0, Math.min(5, pageIndex | 0));
  const sheetPart = await sheetPartFor(book, deps);
  if (!sheetPart) return { plateUrl: null };
  const scenes = Array.isArray(book.scenes) ? book.scenes : [];
  const buf = await genImage(platePrompt(book, scenes[i]), [sheetPart], deps);
  return { plateUrl: buf ? await save(`plate-${i}-${id()}.png`, buf) : null };
}

module.exports = { generateCoverArt, generatePlates, redrawPlate };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all files)

- [ ] **Step 6: Commit**

```bash
git add lib/generateArt.js test/generateArt.test.js package.json package-lock.json
git commit -m "Gemini art pipeline: sheet, cover, plates, redraw — with fallbacks"
```

---

### Task 5: Rate-limit buckets + the three endpoints (server.js and api/ twins)

**Files:**
- Modify: `lib/rateLimit.js`
- Modify: `server.js`
- Create: `api/generate-cover.js`, `api/generate-plates.js`, `api/redraw-page.js`
- Create: `test/rateLimit.test.js`

**Interfaces:**
- Consumes: `generateCoverArt/generatePlates/redrawPlate` from Task 4.
- Produces: `checkRateLimit(ip, bucket?)` — `bucket` optional string; `'art'` bucket = per-IP 3/10min, global 30/hour; default bucket keeps today's numbers and callers.
- HTTP: `POST /api/generate-cover {book}` → `{characterSheetUrl, coverUrl, usedPhoto, fellBackToDescription}`; `POST /api/generate-plates {book}` → `{plateUrls}`; `POST /api/redraw-page {book, pageIndex}` → `{plateUrl}`. All 429 on limit, 400 without `book.audience`.

- [ ] **Step 1: Write the failing test**

Create `test/rateLimit.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { checkRateLimit } = require('../lib/rateLimit');

test('art bucket is stricter and independent of the default bucket', () => {
  const ip = 'test-ip-' + Math.random();
  for (let i = 0; i < 3; i++) assert.strictEqual(checkRateLimit(ip, 'art'), null);
  const limited = checkRateLimit(ip, 'art');
  assert.ok(limited && limited.status === 429);
  // default bucket unaffected
  assert.strictEqual(checkRateLimit(ip), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — current `checkRateLimit` ignores the bucket argument (4th art call returns null).

- [ ] **Step 3: Implement buckets in lib/rateLimit.js**

Restructure internals to keyed buckets, keeping the exported signature backward-compatible:

```js
const BUCKETS = {
  default: { perIpMax: 5, perIpWindowMs: 10 * 60 * 1000, globalMax: 60, globalWindowMs: 60 * 60 * 1000 },
  art:     { perIpMax: 3, perIpWindowMs: 10 * 60 * 1000, globalMax: 30, globalWindowMs: 60 * 60 * 1000 },
};
const state = new Map(); // bucketName -> { perIp: Map, globalHits: [] }
```

`checkRateLimit(ip, bucket = 'default')` looks up config+state per bucket; logic otherwise identical to today (prune, global check, per-IP check, push timestamps). Keep the same message strings.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Add routes to server.js**

After the existing `/api/generate-book` route:

```js
const { generateCoverArt, generatePlates, redrawPlate } = require('./lib/generateArt');

// Photos ride along as base64 — allow a bigger body on art routes only.
const artJson = express.json({ limit: '8mb' });

function artRoute(handler) {
  return async (req, res) => {
    const limited = checkRateLimit(req.ip || 'unknown', 'art');
    if (limited) {
      res.set('Retry-After', String(limited.retryAfterSeconds));
      return res.status(limited.status).json({ error: limited.error, message: limited.message });
    }
    const book = req.body && typeof req.body === 'object' ? req.body.book || req.body : {};
    if (!book.audience) {
      return res.status(400).json({ error: 'missing_audience', message: 'Request body must include "book.audience".' });
    }
    try {
      res.json(await handler(book, req.body));
    } catch (err) {
      console.error('[art] failed:', err.message);
      res.status(502).json({ error: 'art_failed', message: 'Could not paint right now.' });
    }
  };
}

app.post('/api/generate-cover', artJson, artRoute((book) => generateCoverArt(book)));
app.post('/api/generate-plates', artJson, artRoute((book) => generatePlates(book)));
app.post('/api/redraw-page', artJson, artRoute((book, body) => redrawPlate(book, body.pageIndex)));
```

- [ ] **Step 6: Create the api/ serverless twins**

`api/generate-cover.js` (twins follow `api/generate-book.js`'s exact shape):

```js
// Vercel serverless twin of /api/generate-cover in server.js.
const { generateCoverArt } = require('../lib/generateArt');
const { checkRateLimit } = require('../lib/rateLimit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed', message: 'POST only.' });
    return;
  }
  const fwd = req.headers['x-forwarded-for'];
  const ip = (typeof fwd === 'string' && fwd.split(',')[0].trim()) ||
    (req.socket && req.socket.remoteAddress) || 'unknown';
  const limited = checkRateLimit(ip, 'art');
  if (limited) {
    res.setHeader('Retry-After', String(limited.retryAfterSeconds));
    res.status(limited.status).json({ error: limited.error, message: limited.message });
    return;
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const book = body.book || body;
  if (!book.audience) {
    res.status(400).json({ error: 'missing_audience', message: 'Request body must include "book.audience".' });
    return;
  }
  try {
    res.status(200).json(await generateCoverArt(book));
  } catch (err) {
    console.error('[generate-cover] failed:', err.message);
    res.status(502).json({ error: 'art_failed', message: 'Could not paint right now.' });
  }
};
```

`api/generate-plates.js`: identical shell, calls `generatePlates(book)`.
`api/redraw-page.js`: identical shell, calls `redrawPlate(book, body.pageIndex)`.

- [ ] **Step 7: Smoke test the local endpoints**

Run (server running via `npm start`; no GEMINI key set → graceful nulls):

```bash
curl -s -X POST localhost:4000/api/generate-cover -H 'Content-Type: application/json' \
  -d '{"book":{"audience":"child","direction":0,"data":{"age":"7","looks":"curly hair"}}}'
```

Expected: `{"characterSheetUrl":null,"coverUrl":null,"usedPhoto":false,"fellBackToDescription":false}` (HTTP 200 — graceful no-key behavior). Then repeat 3 more times: 4th returns HTTP 429.

- [ ] **Step 8: Commit**

```bash
git add lib/rateLimit.js test/rateLimit.test.js server.js api/generate-cover.js api/generate-plates.js api/redraw-page.js
git commit -m "Art endpoints with stricter rate bucket (server + Vercel twins)"
```

---

### Task 6: Book Builder — photo upload with consent

**Files:**
- Modify: `Book Builder.dc.html` (step-2 panel markup ~line 100-120; logic class)

**Interfaces:**
- Consumes: nothing new server-side (photo only travels at Preview time).
- Produces: the saved book object (localStorage `farsh.book`) gains `photo` (child: one data-URL string) or `photos` (couple: array of up to 2), plus `photoConsent: true`. Family: no photo UI. Client downscales to max 1024px JPEG via canvas (drops EXIF, keeps localStorage small).

- [ ] **Step 1: Add the upload UI to step 2**

In the step-2 "Tell us about them" panel, after the "WHAT THEY LOOK LIKE" field (child) and after the partner-name fields (couple), insert (uses existing inline-style conventions):

```html
<sc-if value="{{ showPhotoUpload }}" hint-placeholder-val="{{ false }}">
  <div style="margin-top:18px;padding-top:16px;border-top:2px solid var(--color-divider);">
    <span style="display:block;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:var(--color-neutral-600);margin-bottom:8px;">Optional — a photo to draw them from</span>
    <sc-if value="{{ hasPhoto }}" hint-placeholder-val="{{ false }}">
      <div style="display:flex;align-items:center;gap:14px;">
        <div data-photo-thumb style="{{ photoThumbStyle }}"></div>
        <button onClick="{{ onRemovePhoto }}" style="border:2px solid var(--color-text);background:var(--color-bg);color:var(--color-text);font-family:var(--font-heading);font-weight:800;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;padding:9px 13px;cursor:pointer;">Remove</button>
      </div>
    </sc-if>
    <sc-if value="{{ noPhotoYet }}" hint-placeholder-val="{{ true }}">
      <label style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;cursor:pointer;">
        <input type="checkbox" checked="{{ photoConsent }}" onChange="{{ onPhotoConsent }}" style="margin-top:3px;"/>
        <span style="font-size:13px;line-height:1.5;color:var(--color-neutral-700);max-width:46ch;">I have the right to use this photo and consent to it being used once to illustrate this book. It is not stored.</span>
      </label>
      <input type="file" accept="image/*" onChange="{{ onPhotoPick }}" disabled="{{ photoPickDisabled }}" style="font-size:13px;"/>
    </sc-if>
  </div>
</sc-if>
```

- [ ] **Step 2: Add the logic**

In the `Component` class of `Book Builder.dc.html`:

```js
// in state: photo: null, photoConsent: false
// in save(): include photo: this.state.photo, photoConsent: this.state.photoConsent

async downscalePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, err) => {
      const i = new Image();
      i.onload = () => ok(i); i.onerror = err; i.src = url;
    });
    const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85); // canvas re-encode drops EXIF
  } finally { URL.revokeObjectURL(url); }
}
```

renderVals additions:

```js
showPhotoUpload: a !== 'family',
hasPhoto: !!this.state.photo,
noPhotoYet: !this.state.photo,
photoConsent: this.state.photoConsent,
photoPickDisabled: !this.state.photoConsent,
photoThumbStyle: {
  width: '72px', height: '72px', backgroundSize: 'cover', backgroundPosition: 'center',
  border: '2px solid var(--color-text)',
  backgroundImage: this.state.photo ? 'url(' + this.state.photo + ')' : 'none',
},
onPhotoConsent: (e) => this.setState({ photoConsent: e.target.checked }),
onPhotoPick: async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const photo = await this.downscalePhoto(f);
  this.setState({ photo });
},
onRemovePhoto: () => this.setState({ photo: null }),
```

(Couple: v1 keeps a single shared `photo` slot labeled "a photo of the two of you" — one photo containing both people; the prompt's photo path handles it. This avoids a two-slot UI while satisfying "couple: up to 2" as a fast follow.)

- [ ] **Step 3: Verify in the browser**

Run: server running; open `http://localhost:4000/Book Builder.dc.html?for=child`, go to step 02.
Expected: consent checkbox present; file input disabled until checked; picking an image shows the thumbnail; Remove works; `JSON.parse(localStorage.getItem('farsh.book')).photo` starts with `data:image/jpeg`. Family (`?for=family`): no photo block.

- [ ] **Step 4: Commit**

```bash
git add "Book Builder.dc.html"
git commit -m "Builder: optional photo upload with consent, client-side downscale"
```

---

### Task 7: Book Preview — cover generation + display

**Files:**
- Modify: `Book Preview.dc.html` (componentDidMount ~line 206, generate ~line 356, header markup ~line 100-117, fingerprint area ~line 328)

**Interfaces:**
- Consumes: `POST /api/generate-cover`; `artFingerprint` logic duplicated client-side (same JSON shape as `lib/artPrompts.js` — keep in sync by hand like `CHAPTER_BEATS` already is).
- Produces: book object gains `characterSheetUrl`, `coverUrl`, `artFor`, `artNote` (set when `fellBackToDescription`).

- [ ] **Step 1: Add client-side artFingerprint + maybeGenerateArt**

In the `Component` class (next to the existing `fingerprint`):

```js
artFingerprint(book) {
  const d = (book && book.data) || {};
  const h = (s) => { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) >>> 0; return x.toString(36); };
  return JSON.stringify({
    audience: book.audience, direction: book.direction || 0,
    looks: d.looks || '', age: d.age || '', members: d.members || '',
    photo: book.photo ? h(book.photo) : '',
  });
}

maybeGenerateArt(book) {
  const fp = this.artFingerprint(book);
  if (book.coverUrl && book.artFor === fp) return;
  this.generateArt(book, fp);
}

async generateArt(book, fp) {
  this.setState({ paintingCover: true });
  try {
    const res = await fetch('/api/generate-cover', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || 'paint failed');
    const updated = {
      ...this.state.book,
      characterSheetUrl: json.characterSheetUrl || null,
      coverUrl: json.coverUrl || null,
      artFor: fp,
      artNote: json.fellBackToDescription ? 'We illustrated from your description instead of the photo.' : '',
    };
    try { localStorage.setItem('farsh.book', JSON.stringify(updated)); } catch (e) {}
    this.setState({ book: updated, paintingCover: false });
  } catch (e) {
    this.setState({ paintingCover: false }); // silent: typeset cover remains
  }
}
```

Call `this.maybeGenerateArt(book)` in `componentDidMount` right after the existing `if (book) this.maybeGenerate(book);`.

- [ ] **Step 2: Show the cover art in the header**

In the header section (next to the title block), add:

```html
<sc-if value="{{ hasCoverArt }}" hint-placeholder-val="{{ false }}">
  <div style="width:clamp(90px,10vw,140px);aspect-ratio:3/4;background-size:cover;background-position:center;border:2px solid var(--color-accent-900);box-shadow:var(--shadow-md);transform:rotate(-2deg);flex-shrink:0;" data-cover-art style="{{ coverArtStyle }}"></div>
</sc-if>
<sc-if value="{{ paintingCover }}" hint-placeholder-val="{{ false }}">
  <span style="font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-accent-700);">Painting the cover…</span>
</sc-if>
<sc-if value="{{ artNoteView }}" hint-placeholder-val="{{ false }}">
  <span style="font-size:12px;color:var(--color-neutral-600);">{{ artNote }}</span>
</sc-if>
```

renderVals additions:

```js
hasCoverArt: !!(this.state.book && this.state.book.coverUrl),
coverArtStyle: { backgroundImage: this.state.book && this.state.book.coverUrl ? 'url(' + this.state.book.coverUrl + ')' : 'none' },
paintingCover: !!this.state.paintingCover,
artNoteView: !!(this.state.book && this.state.book.artNote),
artNote: (this.state.book && this.state.book.artNote) || '',
```

- [ ] **Step 3: Add the "painted after you approve" caption near the flip book**

Under the book caption element, add a static line:

```html
<div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:var(--color-neutral-600);text-align:center;margin-top:8px;">Final illustrations are painted after you approve</div>
```

- [ ] **Step 4: Verify in the browser**

Without `GEMINI_API_KEY`: open Preview → no cover art, no error, "Painting the cover…" appears briefly then disappears, book renders normally. With a key (if available): cover art appears within ~30s and survives reload (cached by `artFor`).

- [ ] **Step 5: Commit**

```bash
git add "Book Preview.dc.html"
git commit -m "Preview: generate and show cover art with art fingerprint caching"
```

---

### Task 8: Checkout — plates after purchase + confirmation art

**Files:**
- Modify: `Checkout.dc.html` (onPlace ~line 475, confirmation section, confirm cover added earlier ~line 180-195)

**Interfaces:**
- Consumes: `POST /api/generate-plates`; book object from localStorage (has `characterSheetUrl`, `scenes`).
- Produces: book object gains `plateUrls: (string|null)[6]`; confirmation mini-cover shows `coverUrl` art when present.

- [ ] **Step 1: Fire plates generation on order placement**

Extend `onPlace`:

```js
onPlace: () => {
  const no = 'FA-' + String(Math.floor(1000 + Math.random() * 8999));
  this.setState({ placed: true, order: no });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  this.paintPlates();
},
```

Add to the class:

```js
async paintPlates() {
  const book = this.state.book;
  if (!book || !book.characterSheetUrl || (Array.isArray(book.plateUrls) && book.plateUrls.some(Boolean))) return;
  this.setState({ painting: true });
  try {
    const res = await fetch('/api/generate-plates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book }),
    });
    const json = await res.json().catch(() => ({}));
    const plateUrls = Array.isArray(json.plateUrls) ? json.plateUrls : [];
    const updated = { ...book, plateUrls };
    try { localStorage.setItem('farsh.book', JSON.stringify(updated)); } catch (e) {}
    this.setState({ book: updated, painting: false });
  } catch (e) { this.setState({ painting: false }); }
}
```

- [ ] **Step 2: Confirmation shows painting status and real cover**

In the confirmation section add under the blurb:

```html
<sc-if value="{{ painting }}" hint-placeholder-val="{{ false }}">
  <p style="font-size:14px;margin:14px 0 0;opacity:0.85;">Your illustrations are being painted — {{ paintingJoke }}</p>
</sc-if>
```

renderVals: `painting: !!this.state.painting`, and a `paintingJoke` cycled from a small local const (reuse the joke lines from Book Preview verbatim) via a `setInterval` started in `paintPlates` and cleared when painting ends (mirror the Preview `jokeTimer` pattern: store on `this.jokeTimer`, clear in `componentWillUnmount`).

The confirmation mini-cover (`confirmCoverStyle` div added previously): when `this.state.book && this.state.book.coverUrl`, add `backgroundImage: 'url(' + this.state.book.coverUrl + ')', backgroundSize: 'cover', backgroundPosition: 'center'` to `confirmCoverStyle` and hide the typeset text inside it (wrap the inner text in `sc-if value="{{ noCoverArt }}"`).

- [ ] **Step 3: Verify in the browser**

Without a key: place an order → "being painted" appears, then quietly ends; `plateUrls` in localStorage is `[null,null,null,null,null,null]` or absent; confirmation still shows typeset mini-cover. No console errors.

- [ ] **Step 4: Commit**

```bash
git add Checkout.dc.html
git commit -m "Checkout: paint plates after purchase; confirmation shows real cover"
```

---

### Task 9: Preview uses real plates + per-page redraw

**Files:**
- Modify: `Book Preview.dc.html` (spreads ~line 376, spreadHalf ~line 433, edit-rail area near the rewrite button)

**Interfaces:**
- Consumes: `book.plateUrls` (Task 8), `POST /api/redraw-page`.
- Produces: plates render generated art when available; redraw button per page.

- [ ] **Step 1: Prefer generated plates in spreads()**

In `spreads()`, where `img: PLATES[i % PLATES.length]` is set, change to:

```js
const gen = (this.state.book && Array.isArray(this.state.book.plateUrls)) ? this.state.book.plateUrls : [];
// per item:
img: gen[i] || PLATES[i % PLATES.length],
```

(The `imgStyle`/`spreadHalf` code paths already consume `s.img`, so nothing else changes.)

- [ ] **Step 2: Add the redraw button**

Next to the existing "Rewrite this line" button, add:

```html
<sc-if value="{{ hasGeneratedPlate }}" hint-placeholder-val="{{ false }}">
  <button onClick="{{ onRedraw }}" style="border:2px solid var(--color-text);background:var(--color-bg);color:var(--color-text);font-family:var(--font-heading);font-weight:800;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;padding:10px 14px;cursor:pointer;">{{ redrawLabel }}</button>
</sc-if>
```

Class logic:

```js
async redrawPage() {
  const book = this.state.book, i = this.state.page;
  if (!book || this.state.redrawing) return;
  this.setState({ redrawing: true });
  try {
    const res = await fetch('/api/redraw-page', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book, pageIndex: i }),
    });
    const json = await res.json().catch(() => ({}));
    if (json.plateUrl) {
      const plateUrls = [...(book.plateUrls || [])]; plateUrls[i] = json.plateUrl;
      const updated = { ...book, plateUrls };
      try { localStorage.setItem('farsh.book', JSON.stringify(updated)); } catch (e) {}
      this.setState({ book: updated, redrawing: false });
      this.paintBook();
      return;
    }
    this.setState({ redrawing: false });
  } catch (e) { this.setState({ redrawing: false }); }
}
```

renderVals: `hasGeneratedPlate: !!(this.state.book && this.state.book.plateUrls && this.state.book.plateUrls[this.state.page])`, `onRedraw: () => this.redrawPage()`, `redrawLabel: this.state.redrawing ? 'Repainting…' : 'Redraw this picture'`.

- [ ] **Step 3: Verify in the browser**

Seed localStorage with fake `plateUrls` (`['uploads/pages/waking-up.jpg', null, null, null, null, null]`): page 1 shows that image and the redraw button; page 2 shows stock plate and no button. Without a key, clicking redraw ends quietly with the image unchanged.

- [ ] **Step 4: Commit**

```bash
git add "Book Preview.dc.html"
git commit -m "Preview: render generated plates and add per-page redraw"
```

---

### Task 10: Env docs + deploy notes + full-suite verification

**Files:**
- Modify: `.env.example`, `README.md`, `.gitignore`

**Interfaces:** none — documentation and final verification.

- [ ] **Step 1: Document the new env vars**

Append to `.env.example`:

```
# Image generation (Gemini). Get a key at https://aistudio.google.com/apikey
GEMINI_API_KEY=
# Optional model override:
# GEMINI_IMAGE_MODEL=gemini-2.5-flash-image

# Vercel Blob storage for generated art (required on Vercel; locally the
# server writes uploads/generated/ instead). From the Vercel dashboard:
BLOB_READ_WRITE_TOKEN=
```

Add `uploads/generated/` to `.gitignore`.

- [ ] **Step 2: README section**

Add a short "Illustrations" section to `README.md`: the three endpoints, the hybrid trigger, the fallback behavior, and the two required env vars — 6-8 lines, mirroring the existing README voice.

- [ ] **Step 3: Run the whole test suite + smoke the funnel**

Run: `npm test` — expected: all pass.
Then with the server running, click through Landing → Builder (with a photo) → Preview → Checkout → order, keyless: everything renders with stock art, zero console errors.

- [ ] **Step 4: Commit**

```bash
git add .env.example README.md .gitignore
git commit -m "Document illustration env vars and deploy requirements"
```
