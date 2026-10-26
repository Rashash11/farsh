# Photoreal Eleven-Page Book Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Farsh! writes an eleven-page, read-aloud story from the child's details and illustrates it photorealistically from the child's own photo, with the order email carrying the whole approved book.

**Architecture:** All logic stays in `lib/`; `server.js` and `api/*.js` are thin twins. The character-sheet step is deleted: the EXIF-stripped photo is the primary reference for the cover and every plate, and the cover is a secondary reference for plates. Scenes are signed by the server so the plate routes cannot be driven with arbitrary text. The static dc-runtime pages read page count from the generated book and keep an eleven-page sample by hand.

**Tech Stack:** Node ≥ 18, CommonJS, Express 5, `node --test`, Anthropic SDK (text), Gemini REST (images), Resend REST (email), Playwright MCP for browser checks.

**Spec:** `docs/superpowers/specs/2026-10-26-photoreal-eleven-page-book-design.md`

## Global Constraints

- Logic lives in `lib/`. Change a route in `server.js` → change its `api/*.js` twin.
- Route order in `server.js`: 8mb `artJson` routes stay registered before the app-wide 256kb `express.json()`.
- Every user field that reaches a paid model is clamped. Rate limits bound count, not cost, so weights are explicit.
- Degrade to stock content, never to a lie. Failed order fails loudly. Customer-facing `message` never carries internals.
- `PAGE_COUNT = 11` story pages; the cover is separate. Words per page 50–90. `max_tokens` ≥ 6000.
- Art is photorealistic cinematic; no text in images; plates 1:1, cover 3:4.
- Photo and `photoConsent === true` are required for every book.
- Only the child book is sold (`lib/audiences.js`); couple/family code is left dormant and untouched.
- Comments explain *why*, at length. Commit messages: sentence-case imperative describing the user-visible effect.
- `support.js` is generated — never hand-edit.
- Tests: `npm test` runs `node --test test/*.test.js`; no mocking library — inject `fetchFn`/`saveFn`/`deps`.

---

## File map

| File | Responsibility after this plan |
|---|---|
| `lib/pageCount.js` (new) | The single `PAGE_COUNT` constant |
| `lib/generateBook.js` | Eleven-beat prompt, strict normalize, 6000-token budget |
| `lib/artPrompts.js` | Photoreal style, identity block, clamps, moods; sheet prompts deleted |
| `lib/generateArt.js` | Photo + cover references, concurrency 3, abort, 429 backoff; sheet code deleted |
| `lib/scenesToken.js` (new) | Sign/verify the scenes array (wraps `orderToken`) |
| `lib/rateLimit.js` | Weighted `checkRateLimit(ip, bucket, weight)`; image-budget `art` bucket |
| `lib/placeOrder.js` | Requires photo, consent, `PAGE_COUNT` pages |
| `lib/sendOrderEmail.js` | `THE PAGES` section: texts, cover, plates |
| `server.js`, `api/generate-book.js`, `api/generate-plates.js`, `api/redraw-page.js`, `api/generate-cover.js` | Token issue/verify, weights, `maxDuration` |
| `tools/trial-photoreal.js` (new, throwaway) | Phase 0 refusal trial |
| `Book Builder.dc.html` | Required photo, consent copy, mood blurbs, merging save |
| `Book Preview.dc.html` | 11 sample pages, page numbers, photo kept, edits persisted, no-photo bounce |
| `Checkout.dc.html` | Fill-null-slots plates, full order payload, screenshot downscale, photo cleared |
| `Landing Page.dc.html` | Copy |
| `README.md`, `CLAUDE.md`, `.env.example` | Docs |

---

# Phase 1 — server and prompts

### Task 1: PAGE_COUNT constant

**Files:**
- Create: `lib/pageCount.js`
- Test: `test/pageCount.test.js`

**Interfaces:**
- Produces: `const { PAGE_COUNT } = require('./pageCount')` → `11` (number).

- [ ] **Step 1: Write the failing test**

```js
// test/pageCount.test.js
const test = require('node:test');
const assert = require('node:assert');

test('a book has eleven story pages after the cover', () => {
  const { PAGE_COUNT } = require('../lib/pageCount');
  assert.strictEqual(PAGE_COUNT, 11);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pageCount.test.js`
Expected: FAIL with `Cannot find module '../lib/pageCount'`

- [ ] **Step 3: Write the module**

```js
// lib/pageCount.js
//
// How many story pages a book has, not counting the cover. This is the one
// number the story schema, the plate loop, the redraw clamp and the order
// validator all have to agree on. The static pages cannot import it (there
// is no build step), so Book Preview's sample story is kept at this length
// by hand and the front end otherwise reads `pages.length` from the book.
const PAGE_COUNT = 11;

module.exports = { PAGE_COUNT };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/pageCount.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/pageCount.js test/pageCount.test.js
git commit -m "Name the number of story pages in one place"
```

---

### Task 2: Eleven-beat story prompt and strict page normalising

**Files:**
- Modify: `lib/generateBook.js` (header comment lines 1-6, `CHAPTER_BEATS` lines 12-37, prompt text lines 79-96, `max_tokens` line 137, `normalizePages` lines 163-178)
- Test: `test/generateBook.test.js`

**Interfaces:**
- Consumes: `PAGE_COUNT` from Task 1.
- Produces: `buildPrompt(book)` → string; `normalizePages(parsed)` → `{ pages: string[], scenes: string[] }` of length `PAGE_COUNT`, throws `Error('generation_short')` when fewer; `generateBookPages(book, apiKey, deps = {})` where `deps.client` (object with `messages.create`) overrides the SDK client for tests. `CHAPTER_BEATS.child` has 11 entries.

- [ ] **Step 1: Replace the two six-page tests and add the new ones**

In `test/generateBook.test.js`, replace the test named `normalizePages splits objects into pages and scenes, padded to 6` with:

```js
test('normalizePages returns exactly PAGE_COUNT pages and scenes', () => {
  const { PAGE_COUNT } = require('../lib/pageCount');
  const items = Array.from({ length: PAGE_COUNT + 2 }, (_, i) => ({ text: `Page ${i}.`, scene: `scene ${i}` }));
  const { pages, scenes } = normalizePages({ pages: items });
  assert.strictEqual(pages.length, PAGE_COUNT);
  assert.strictEqual(scenes.length, PAGE_COUNT);
  assert.strictEqual(pages[0], 'Page 0.');
  assert.strictEqual(scenes[PAGE_COUNT - 1], `scene ${PAGE_COUNT - 1}`);
});

test('normalizePages refuses a short story rather than repeating the ending', () => {
  const items = [{ text: 'One.', scene: 'a' }, { text: 'Two.', scene: 'b' }];
  assert.throws(() => normalizePages({ pages: items }), /generation_short/);
});
```

In the test `buildPrompt keeps each field on one line, so it cannot add prompt structure`, change the last two lines to:

```js
  const numbered = injected.split('\n').filter((l) => /^\d+\. /.test(l));
  assert.strictEqual(numbered.length, 11, 'exactly the eleven real beats stay numbered');
```

Append:

```js
test('buildPrompt asks for eleven pages of fifty to ninety words with the child acting', () => {
  const p = buildPrompt({ audience: 'child', names: 'Nova', data: { name: 'Nova' } });
  assert.match(p, /exactly 11 /);
  assert.match(p, /50.{0,3}90 words/);
  assert.match(p, /doing something/i);
  assert.match(p, /kind/i);
  assert.match(p, /photograph/i); // scene briefs are written for a photographer
});

test('CHAPTER_BEATS.child has PAGE_COUNT entries', () => {
  const { CHAPTER_BEATS } = require('../lib/generateBook');
  const { PAGE_COUNT } = require('../lib/pageCount');
  assert.strictEqual(CHAPTER_BEATS.child.length, PAGE_COUNT);
});

test('generateBookPages asks the model for a budget that fits eleven pages', async () => {
  const { generateBookPages } = require('../lib/generateBook');
  let seen = null;
  const pages = Array.from({ length: 11 }, (_, i) => ({ text: `Page ${i}.`, scene: `s${i}` }));
  const client = { messages: { create: async (req) => { seen = req; return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ pages }) }] }; } } };
  const r = await generateBookPages({ audience: 'child', names: 'Nova', data: { name: 'Nova' } }, 'k', { client });
  assert.ok(seen.max_tokens >= 6000, 'max_tokens was ' + seen.max_tokens);
  assert.strictEqual(r.pages.length, 11);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/generateBook.test.js`
Expected: FAIL — `generation_short` not thrown, `exactly the eleven real beats` is 6, `/exactly 11 /` not matched, `CHAPTER_BEATS.child.length` is 6, `generateBookPages` ignores `deps.client` (SDK call attempted / max_tokens 2048).

- [ ] **Step 3: Rewrite the beats, the prompt, the budget, and normalize**

Replace lines 1-6 (header comment) with:

```js
// Calls Claude to write the PAGE_COUNT story pages for a book, personalized
// from what the parent entered in Book Builder. Returns PAGE_COUNT page
// texts and PAGE_COUNT one-line scene briefs. Page headings are not
// generated: the frontend numbers the pages, so a weak generation can never
// break the page structure the Preview expects.
```

Add after `const Anthropic = require('@anthropic-ai/sdk');`:

```js
const { PAGE_COUNT } = require('./pageCount');
```

Replace the `child:` array in `CHAPTER_BEATS` with these eleven beats (leave `couple:` and `family:` as they are):

```js
  child: [
    'A wish — an ordinary morning, and something the child longs to see or do',
    'Setting out — exploring somewhere new, hands-on and curious',
    'A small creature in trouble — the child stops, kneels, and helps',
    'The journey — travelling further than expected, unafraid',
    'A discovery — a clue, a map, a story, or a door that points onward',
    'Something large — meeting a creature or a place that looks frightening and is not',
    'Staying brave — the hard moment, and choosing to stay and help anyway',
    'Helping the community — working alongside others to put something right',
    'A gift — giving something away to someone who needs it more',
    'Recognition — someone the child loves sees what they did, and says so',
    'The last page — home, looking out, knowing more adventures are coming',
  ],
```

Replace the whole return template in `buildPrompt` (from `` return `You are writing `` through the closing backtick and `;`) with:

```js
  return `You are writing the text for a personalized hardcover children's picture book sold by Farsh!, a company that makes made-to-order children's books. Write exactly ${PAGE_COUNT} page texts for this book, one per beat listed below, in order.

Audience: a young child (this book stars them as the hero)
Names / subject: ${names || '(not given — use "you" or a warm generic address)'}
Title: ${title || '(untitled)'}
Details:
${fields}
${woven ? `Things to weave in naturally: ${woven}` : ''}
${dedication ? `Dedication (do not repeat it in the pages): ${dedication}` : ''}

Beats, one page each:
${beats.map((b, i) => `${i + 1}. ${b}`).join('\n')}

Rules for the text:
- 50 to 90 words per page. Short sentences. Natural, warm English a parent reads aloud.
- The child is doing something on every page: exploring, helping, riding, climbing, deciding. Never a page that only describes how they look.
- The backbone is kindness, courage and helping others; the last page looks forward.
- Use the child's name and details given above. Never invent a different name.
- No violence, no real danger, no frightening endings. Anything scary turns out gentle.

Rules for the scene briefs:
- One line per page, written for a photographer, not a painter: where the child is, what they are doing, time of day, light (morning sun, golden hour, candlelight, moonlight).
- Do not repeat the name in the scene line (say "the child").
- One single moment per scene, never two.

Return JSON: { "pages": [ { "text": "...", "scene": "..." }, ... ] } with exactly ${PAGE_COUNT} entries.`;
```

Change `max_tokens: 2048,` to `max_tokens: 6000,` and add a comment above it:

```js
    // Eleven pages × up to 90 words, plus a scene line each, plus JSON
    // punctuation is well over the old 2048. A truncated JSON here fails to
    // parse and silently becomes the sample story, so the budget is generous.
```

Change the signature and client construction in `generateBookPages`:

```js
async function generateBookPages(book, apiKey, deps = {}) {
  let client = deps.client;
  if (!client) {
    try {
      client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
    } catch (e) {
      // SDK throws synchronously when no credential source resolves.
      throw new Error('missing_api_key');
    }
  }
```

Replace `normalizePages` with:

```js
// Normalize to exactly PAGE_COUNT pages/scenes — the schema can't enforce
// array length. Extra pages are dropped. A SHORT story throws rather than
// being padded by repeating the last page: with eleven pages, padding would
// print two copies of the ending, and the route already knows how to fall
// back to the sample story on any failure.
// Also tolerates legacy plain-string page entries (pre-scene responses).
function normalizePages(parsed) {
  let items = Array.isArray(parsed.pages) ? parsed.pages : [];
  items = items
    .map((p) => (typeof p === 'string' ? { text: p, scene: '' } : p))
    .filter((p) => p && typeof p.text === 'string' && p.text.trim());
  if (items.length === 0) throw new Error('empty_pages');
  if (items.length < PAGE_COUNT) throw new Error(`generation_short:${items.length}`);
  items = items.slice(0, PAGE_COUNT);
  return {
    pages: items.map((p) => p.text),
    scenes: items.map((p) => (typeof p.scene === 'string' ? p.scene : '')),
  };
}
```

Update the JSDoc on `generateBookPages` to say `exactly PAGE_COUNT page-text strings` and add `@param {object} [deps] - { client } to inject a messages client in tests`.

- [ ] **Step 4: Run the tests**

Run: `node --test test/generateBook.test.js`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add lib/generateBook.js test/generateBook.test.js
git commit -m "Write eleven read-aloud pages with the child acting on every one"
```

---

### Task 3: Photorealistic art prompts with clamped fields

**Files:**
- Modify: `lib/artPrompts.js` (whole file except the couple/family style blocks, `hashStr`, `artFingerprint`)
- Test: `test/artPrompts.test.js`

**Interfaces:**
- Produces: `CONSTRAINTS`, `IDENTITY`, `STYLE_BLOCKS`, `platePrompt(book, scene)`, `coverPrompt(book)`, `MOODS` (array of 3 `{ key, title }`), `clampField(value, max)`. `characterSheetPrompt` and `photoSheetPrompt` are **removed**.

- [ ] **Step 1: Rewrite the tests**

Replace `test/artPrompts.test.js` entirely:

```js
const test = require('node:test');
const assert = require('node:assert');
const {
  STYLE_BLOCKS, CONSTRAINTS, IDENTITY, MOODS,
  platePrompt, coverPrompt, artFingerprint,
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

test('the sheet prompts are gone', () => {
  const mod = require('../lib/artPrompts');
  assert.strictEqual(mod.characterSheetPrompt, undefined);
  assert.strictEqual(mod.photoSheetPrompt, undefined);
});

test('child styles are photorealistic, never painted', () => {
  for (const d of [0, 1, 2]) {
    assert.match(STYLE_BLOCKS.child[d], /photoreal/i);
    assert.doesNotMatch(STYLE_BLOCKS.child[d], /gouache|painted|brushwork/i);
  }
  assert.match(CONSTRAINTS, /photoreal/i);
  assert.doesNotMatch(CONSTRAINTS, /never photorealistic/i);
  assert.match(CONSTRAINTS, /no text/i);
  assert.match(CONSTRAINTS, /cartoon|anime/i);
});

test('cover and plate prompts carry the identity block and end with the constraints', () => {
  for (const p of [platePrompt(child, 'the child opens a green door'), coverPrompt(child)]) {
    assert.ok(p.includes(IDENTITY), 'identity block missing');
    assert.ok(p.trim().endsWith(CONSTRAINTS), p.slice(-120));
    assert.match(p, /attached photograph/i);
  }
  assert.match(IDENTITY, /never age/i);
  assert.match(IDENTITY, /identity wins|identity must win/i);
});

test('plate prompt is square and leaves room for text; cover is portrait with calm top third', () => {
  assert.match(platePrompt(child, 'a'), /1:1/);
  assert.match(platePrompt(child, 'a'), /negative space|room for text/i);
  assert.match(coverPrompt(child), /3:4/);
  assert.match(coverPrompt(child), /top third/i);
});

test('prompts include looks and age, never the name', () => {
  const p = platePrompt(child, 'the child climbs a wall');
  assert.match(p, /curly dark hair/);
  assert.match(p, /7-year-old/);
  assert.ok(!p.includes('Nova'));
});

test('every user field that reaches the image model is bounded', () => {
  const big = 'x'.repeat(5000);
  const book = { ...child, title: big, data: { name: 'N', age: big, looks: big } };
  const plate = platePrompt(book, big);
  const cover = coverPrompt(book);
  assert.ok(plate.length < 2500, 'plate prompt is ' + plate.length);
  assert.ok(cover.length < 2500, 'cover prompt is ' + cover.length);
  assert.ok(!plate.includes('\n' + 'x'.repeat(400)), 'scene not clamped');
});

test('MOODS lists three child directions', () => {
  assert.deepStrictEqual(MOODS.map((m) => m.key), ['golden', 'moonlit', 'kingdom']);
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

Run: `node --test test/artPrompts.test.js`
Expected: FAIL — `IDENTITY`/`MOODS` undefined, sheet prompts still exported, constraints say "never photorealistic".

- [ ] **Step 3: Rewrite the prompt builders**

Replace everything in `lib/artPrompts.js` from the top through the end of `coverPrompt` (keep `hashStr`, `artFingerprint`, and fix `module.exports`):

```js
// Pure prompt builders for book illustrations. No network, no state —
// everything here is snapshot-testable. Style blocks are versioned by
// being literal strings: change one and the artFingerprint stays the
// same on purpose (style tweaks should not invalidate every cached book).
//
// The child book is photographed, not painted: the owner's brief asks for
// frames from a live-action fairytale film, with the real child's face
// preserved from their photo. Couple/family blocks below are dormant (only
// the child book is sold, see lib/audiences.js) and keep the old painted
// wording until someone decides what those books should look like.

const CONSTRAINTS =
  'Photorealistic cinematic photograph only: real skin texture, real hair ' +
  'strands, natural eyes, physically plausible light and shadow, natural ' +
  'body proportions, believable fabric and objects. Never cartoon, anime, ' +
  'Pixar/3D, doll-like, painterly or beauty-filtered. No text, letters, ' +
  'numbers, borders or watermarks in the image. One single coherent scene.';

// The master brief's Part 1. Identity outranks every other instruction in
// the prompt, so it is stated once, verbatim, in every image call.
const IDENTITY =
  'The attached photograph is the child. Keep this exact child: face shape, ' +
  'forehead and hairline, hair texture and curls, eyebrows, eye shape and ' +
  'colour, nose, cheeks, lips, chin, ears, skin tone, and apparent age. ' +
  'Never age the child up. Clothing, hairstyling details, pose, expression, ' +
  'background, lighting and camera angle may change; the face may not. If ' +
  'the scene and the identity conflict, identity wins.';

const BASE_MEDIUM =
  'photorealistic cinematic still from a high-budget live-action fairytale ' +
  'film, shot on a cinema camera, shallow depth of field, rich believable colour';

const MOODS = [
  { key: 'golden', title: 'Golden Hour' },
  { key: 'moonlit', title: 'Moonlit' },
  { key: 'kingdom', title: 'Storybook Kingdom' },
];

const STYLE_BLOCKS = {
  child: {
    0: `Golden Hour: ${BASE_MEDIUM}, warm low sun, long soft shadows, sunlit meadows, gardens and village lanes.`,
    1: `Moonlit: ${BASE_MEDIUM}, blue night, moonlight and lantern light, stars, quiet and dreamlike.`,
    2: `Storybook Kingdom: ${BASE_MEDIUM}, castle stone, banners, candlelit halls, bright clear daylight outdoors.`,
  },
  couple: {
    0: 'Midnight Velvet style: painted storybook illustration, gouache and colored-pencil texture, deep quiet palette of wine and midnight blue, intimate low light, very few elements per scene.',
    1: 'Letter Press style: painted storybook illustration, gouache and colored-pencil texture, vintage letterpress texture on thick cream paper, muted inks, classical and nostalgic.',
    2: 'Paper Garden style: painted storybook illustration, gouache and colored-pencil texture, botanical margins, soft floral colors, lots of white space, delicate organic shapes.',
  },
  family: {
    0: 'Kitchen Table style: painted storybook illustration, gouache and colored-pencil texture, warm domestic light, handwriting-adjacent looseness, everyone mid-conversation.',
    1: 'The Album style: painted storybook illustration, gouache and colored-pencil texture, composed like mounted photographs with painted captions-space, sepia-warmed colors.',
    2: 'Long Table style: painted storybook illustration, gouache and colored-pencil texture, wide tableaus like places set for dinner, earthy welcoming palette.',
  },
};

// Same bounding discipline as lib/generateBook.js: every user-typed field
// that lands in a paid image call is flattened to one line and capped.
const LIMITS = { scene: 300, title: 200, looks: 300, age: 10 };

function clampField(value, max) {
  if (typeof value !== 'string') return '';
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() + '…' : flat;
}

function styleFor(book) {
  const aud = ['child', 'couple', 'family'].includes(book.audience) ? book.audience : 'child';
  const dir = [0, 1, 2].includes(book.direction) ? book.direction : 0;
  return STYLE_BLOCKS[aud][dir];
}

function subjectFor(book) {
  const d = (book.data && typeof book.data === 'object') ? book.data : {};
  const age = clampField(d.age, LIMITS.age);
  const looks = clampField(d.looks, LIMITS.looks);
  return `a ${age ? `${age}-year-old` : 'young'} child${looks ? `, ${looks}` : ''}. Natural expression, age-appropriate clothing.`;
}

function platePrompt(book, scene) {
  return `${IDENTITY}
Subject: ${subjectFor(book)}
Scene: ${clampField(scene, LIMITS.scene) || 'a quiet, warm moment from the story'}.
${styleFor(book)}
Square 1:1 composition. The child clearly visible and actively doing what the scene says. Keep calm negative space on one side as room for text. Other people, if any, at a distance or seen from behind.
${CONSTRAINTS}`;
}

function coverPrompt(book) {
  return `${IDENTITY}
Subject: ${subjectFor(book)}
A book COVER photograph of this child. The scene should evoke the title "${clampField(book.title, LIMITS.title) || 'an adventure'}" — but include NO title text.
${styleFor(book)}
Portrait 3:4 composition; keep the top third calm and uncluttered (a title is typeset over it later).
${CONSTRAINTS}`;
}
```

Set the exports at the bottom to:

```js
module.exports = {
  STYLE_BLOCKS, CONSTRAINTS, IDENTITY, MOODS, LIMITS, clampField,
  platePrompt, coverPrompt, artFingerprint,
};
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/artPrompts.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/artPrompts.js test/artPrompts.test.js
git commit -m "Photograph the child's book instead of painting it"
```

---

### Task 4: Photo as reference, cover as secondary, bounded concurrency

**Files:**
- Modify: `lib/generateArt.js` (delete `sheetPartFor`, rewrite `genImage`, `generateCoverArt`, `generatePlates`, `redrawPlate`)
- Test: `test/generateArt.test.js`

**Interfaces:**
- Consumes: `PAGE_COUNT`, `platePrompt`, `coverPrompt`, `clampField` (Tasks 1, 3).
- Produces:
  - `generateCoverArt(book, deps)` → `{ coverUrl: string|null, usedPhoto: boolean }`.
  - `generatePlates(book, deps)` → `{ plateUrls: (string|null)[] }` of length `PAGE_COUNT`; `book.photo` required; `book.coverUrl` optional secondary reference.
  - `redrawPlate(book, pageIndex, deps)` → `{ plateUrl: string|null }`.
  - `deps`: `{ fetchFn, saveFn, timeoutMs = 60000, backoffMs = 2000, concurrency = 3 }`.
  - Blob host check: `isOwnImageUrl(url)` → true for `/uploads/generated/...` or `https://<anything>.public.blob.vercel-storage.com/...`.

- [ ] **Step 1: Rewrite the tests**

Replace `test/generateArt.test.js` entirely:

```js
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
  let call = 0;
  const fetchFn = async () => {
    call++;
    if (call === 3) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => okBody() };
  };
  const r = await generatePlates({ ...child, scenes }, { fetchFn, saveFn: fakeSave });
  assert.strictEqual(r.plateUrls.length, PAGE_COUNT);
  assert.ok(r.plateUrls.filter(Boolean).length >= PAGE_COUNT - 1);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/generateArt.test.js`
Expected: FAIL — `isOwnImageUrl` undefined, `sheetPartFor` still exported, cover returns `characterSheetUrl`, plates null without sheet, etc.

- [ ] **Step 3: Rewrite the art pipeline**

Replace `lib/generateArt.js` from the header through the end of the file, keeping `looksLikeImage`, `dataUrlToPart`, `defaultSave`, `id`, `safeSave` as they are:

```js
// Gemini image pipeline: photo -> cover -> plates.
// Plain fetch against the REST API (no SDK). All failures degrade to
// null URLs — callers treat null as "keep the stock art for this slot".
//
// There is no character sheet any more. The brief's first rule is that the
// child must be the same real child on every page, and a sheet derived from
// the photo put every plate two generations away from the real face. The
// EXIF-stripped photo is now the primary reference for the cover and for
// every plate, and the cover (once it exists) rides along as a secondary
// reference so clothes and hair stay consistent across eleven separate
// calls. Dropping the sheet also removed a server-side request forgery (the
// sheet URL was fetched wherever the client pointed it) and a test shortcut
// that skipped EXIF stripping in production.

const crypto = require('crypto');
const { stripExif } = require('./stripExif');
const blobStorage = require('./blobStorage');
const { PAGE_COUNT } = require('./pageCount');
const { platePrompt, coverPrompt } = require('./artPrompts');

const MODEL = () => process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const API = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

const DEFAULTS = { timeoutMs: 60 * 1000, backoffMs: 2000, concurrency: 3 };
```

(keep `PNG_MAGIC`, `JPG_MAGIC`, `looksLikeImage`, `dataUrlToPart`, `defaultSave` unchanged)

Replace `genImage` with:

```js
// One Gemini call -> Buffer or null. Never throws.
//
// Every attempt runs under an AbortSignal: with eleven plates per request a
// single hung connection used to hang the whole order confirmation. A 429
// waits `backoffMs` before the one retry; retrying a rate limit immediately
// just spends the retry on the same answer.
async function genImage(prompt, refParts, deps) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const doFetch = deps.fetchFn || fetch;
  const timeoutMs = deps.timeoutMs || DEFAULTS.timeoutMs;
  const backoffMs = deps.backoffMs === undefined ? DEFAULTS.backoffMs : deps.backoffMs;
  const body = JSON.stringify({
    contents: [{ parts: [...(refParts || []), { text: prompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    // The ENTIRE per-attempt body lives inside this try: res.json() can
    // throw on a malformed body and the shape access can throw on an
    // unexpected candidates array; both are transport-class failures that
    // consume a retry, same as a thrown fetch or an abort.
    try {
      const res = await doFetch(API(MODEL(), key), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429) {
        if (attempt === 0 && backoffMs) await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      if (!res.ok) continue; // transport failure -> retry / give up

      const json = await res.json();
      const parts = json.candidates && json.candidates[0] &&
        json.candidates[0].content && json.candidates[0].content.parts || [];
      const img = parts.find((p) => p.inlineData && p.inlineData.data);
      if (!img) return null; // refusal / text-only answer — deterministic, do not retry
      const buf = Buffer.from(img.inlineData.data, 'base64');
      if (looksLikeImage(buf)) return buf;
      // Garbage payload despite an inlineData part: fall through and retry once.
    } catch (e) {
      continue; // network error, abort, bad JSON, or unexpected shape -> retry / give up
    }
  }
  return null;
}
```

(keep `id` and `safeSave`)

Replace `generateCoverArt`, `sheetPartFor`, `generatePlates`, `redrawPlate` and the exports with:

```js
function photoPartFor(book) {
  const photos = book.photos || (book.photo ? [book.photo] : []);
  return photos.map(dataUrlToPart).filter(Boolean)[0] || null;
}

// Only images we produced ourselves are ever fetched back as references:
// a local path inside uploads/generated, or an object on Vercel's public
// Blob host. Anything else is ignored — the plate is drawn from the photo
// alone — because `book` is caller-supplied and a fetchable URL field is a
// server-side request forgery waiting to happen.
function isOwnImageUrl(url) {
  if (typeof url !== 'string') return false;
  if (/^https?:/.test(url)) {
    try { return /\.public\.blob\.vercel-storage\.com$/.test(new URL(url).hostname); } catch (e) { return false; }
  }
  const path = require('path');
  const repoRoot = path.resolve(__dirname, '..');
  const generated = path.join(repoRoot, 'uploads', 'generated');
  const p = path.resolve(repoRoot, url.replace(/^\/+/, ''));
  return p !== generated && p.startsWith(generated + path.sep);
}

async function defaultFetchImage(url, deps) {
  if (/^https?:/.test(url)) {
    const res = await (deps.fetchFn || fetch)(url, { signal: AbortSignal.timeout(deps.timeoutMs || DEFAULTS.timeoutMs) });
    return Buffer.from(await res.arrayBuffer());
  }
  const fs = require('fs'); const path = require('path');
  return fs.readFileSync(path.resolve(__dirname, '..', url.replace(/^\/+/, '')));
}

async function coverPartFor(book, deps) {
  if (!isOwnImageUrl(book.coverUrl)) return null;
  try {
    const buf = await (deps.fetchImage || defaultFetchImage)(book.coverUrl, deps);
    return looksLikeImage(buf) ? { inline_data: { mime_type: 'image/png', data: buf.toString('base64') } } : null;
  } catch (e) { return null; }
}

/** @returns {Promise<{coverUrl: string|null, usedPhoto: boolean}>} */
async function generateCoverArt(book, deps = {}) {
  const save = deps.saveFn || defaultSave;
  const photoPart = photoPartFor(book);
  if (!photoPart) return { coverUrl: null, usedPhoto: false };
  const coverBuf = await genImage(coverPrompt(book), [photoPart], deps);
  const coverUrl = coverBuf ? await safeSave(save, `cover-${id()}.png`, coverBuf) : null;
  return { coverUrl, usedPhoto: !!coverUrl };
}

// Run `fn` over `items` with at most `limit` in flight; results keep order.
async function mapConcurrent(items, limit, fn) {
  const out = new Array(items.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

async function plateFor(book, refs, i, deps) {
  const save = deps.saveFn || defaultSave;
  const scenes = Array.isArray(book.scenes) ? book.scenes : [];
  const buf = await genImage(platePrompt(book, scenes[i]), refs, deps);
  return buf ? await safeSave(save, `plate-${i}-${id()}.png`, buf) : null;
}

/** @returns {Promise<{plateUrls: (string|null)[]}>} always PAGE_COUNT entries */
async function generatePlates(book, deps = {}) {
  const photoPart = photoPartFor(book);
  if (!photoPart) return { plateUrls: new Array(PAGE_COUNT).fill(null) };
  const coverPart = await coverPartFor(book, deps);
  const refs = coverPart ? [photoPart, coverPart] : [photoPart];
  const indexes = Array.from({ length: PAGE_COUNT }, (_, i) => i);
  const plateUrls = await mapConcurrent(indexes, deps.concurrency || DEFAULTS.concurrency, (i) => plateFor(book, refs, i, deps));
  return { plateUrls };
}

async function redrawPlate(book, pageIndex, deps = {}) {
  const i = Math.max(0, Math.min(PAGE_COUNT - 1, pageIndex | 0));
  const photoPart = photoPartFor(book);
  if (!photoPart) return { plateUrl: null };
  const coverPart = await coverPartFor(book, deps);
  const refs = coverPart ? [photoPart, coverPart] : [photoPart];
  return { plateUrl: await plateFor(book, refs, i, deps) };
}

module.exports = { generateCoverArt, generatePlates, redrawPlate, isOwnImageUrl };
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/generateArt.test.js`
Expected: PASS

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS. (If `test/artPrompts.test.js` or any other file still references `characterSheetPrompt`, fix that reference.)

- [ ] **Step 6: Commit**

```bash
git add lib/generateArt.js test/generateArt.test.js
git commit -m "Photograph every page from the child's own photo, three at a time"
```

---

### Task 5: Signed scenes so the plate routes cannot be driven with arbitrary text

**Files:**
- Create: `lib/scenesToken.js`
- Modify: `server.js` (`/api/generate-book` response; `artRoute` for plates/redraw), `api/generate-book.js`, `api/generate-plates.js`, `api/redraw-page.js`
- Test: `test/scenesToken.test.js`

**Interfaces:**
- Consumes: `sign`, `verify` from `lib/orderToken.js` (HMAC with `ORDER_CONFIRM_SECRET`; `deps.secret` overrides).
- Produces: `signScenes(scenes, deps)` → string token; `verifyScenes(token, deps)` → `string[]` or throws `.code 'invalid_token' | 'not_configured'`. Routes: `generate-book` returns `{ pages, scenes, scenesToken }` (`scenesToken` is `null` when the secret is missing, with a `console.error`); `generate-plates` and `redraw-page` require `body.scenesToken`, replace `book.scenes` with the verified scenes, and answer `400 { error: 'invalid_scenes', message: 'Please write the story again before illustrating it.' }` on failure.

- [ ] **Step 1: Write the failing test**

```js
// test/scenesToken.test.js
const test = require('node:test');
const assert = require('node:assert');
const { signScenes, verifyScenes } = require('../lib/scenesToken');

const deps = { secret: 'test-secret' };
const scenes = ['a door', 'a dragon', 'home'];

test('a signed scenes array round-trips', () => {
  const token = signScenes(scenes, deps);
  assert.deepStrictEqual(verifyScenes(token, deps), scenes);
});

test('a tampered token is refused', () => {
  const token = signScenes(scenes, deps);
  const [payload, sig] = token.split('.');
  const other = Buffer.from(JSON.stringify({ scenes: ['the face of anyone I like'] })).toString('base64url');
  assert.throws(() => verifyScenes(`${other}.${sig}`, deps), (e) => e.code === 'invalid_token');
  assert.throws(() => verifyScenes(`${payload}.AAAA`, deps), (e) => e.code === 'invalid_token');
});

test('a token signed under another secret is refused', () => {
  const token = signScenes(scenes, { secret: 'other' });
  assert.throws(() => verifyScenes(token, deps), (e) => e.code === 'invalid_token');
});

test('without a secret, signing and verifying both fail loudly', () => {
  const saved = process.env.ORDER_CONFIRM_SECRET;
  delete process.env.ORDER_CONFIRM_SECRET;
  try {
    assert.throws(() => signScenes(scenes), (e) => e.code === 'not_configured');
    assert.throws(() => verifyScenes('x.y'), (e) => e.code === 'not_configured');
  } finally {
    if (saved !== undefined) process.env.ORDER_CONFIRM_SECRET = saved;
  }
});

test('a token that verifies but does not hold a scenes array is refused', () => {
  const { sign } = require('../lib/orderToken');
  assert.throws(() => verifyScenes(sign({ orderNumber: 'FA-1' }, deps), deps), (e) => e.code === 'invalid_token');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scenesToken.test.js`
Expected: FAIL with `Cannot find module '../lib/scenesToken'`

- [ ] **Step 3: Write the module**

```js
// lib/scenesToken.js
//
// The plate routes take a photo and a list of scene lines and return
// photorealistic images of that face in those scenes. If the scene lines
// came straight from the client, that is a public face-swap service with
// our API key behind it. So /api/generate-book signs the scenes it wrote,
// and the plate routes only illustrate scenes that carry that signature —
// the same stateless HMAC the order-confirm link uses, same secret.

const { sign, verify } = require('./orderToken');

function signScenes(scenes, deps = {}) {
  return sign({ scenes: Array.isArray(scenes) ? scenes.map(String) : [] }, deps);
}

/** @returns {string[]} @throws .code 'invalid_token' | 'not_configured' */
function verifyScenes(token, deps = {}) {
  const summary = verify(token, deps);
  if (!summary || !Array.isArray(summary.scenes) || !summary.scenes.every((s) => typeof s === 'string')) {
    const err = new Error('invalid_scenes_token');
    err.code = 'invalid_token';
    throw err;
  }
  return summary.scenes;
}

module.exports = { signScenes, verifyScenes };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scenesToken.test.js`
Expected: PASS

- [ ] **Step 5: Wire the routes in `server.js`**

Add to the requires at the top:

```js
const { signScenes, verifyScenes } = require('./lib/scenesToken');
```

Change the `artRoute` helper to accept an option and verify the token for plate routes. Replace the current `artRoute` function with:

```js
// `needsScenes` routes illustrate scene lines; those lines must be the
// ones /api/generate-book signed (see lib/scenesToken.js), never the
// client's own text.
function artRoute(handler, { needsScenes = false, weight = 1 } = {}) {
  return async (req, res) => {
    const limited = checkRateLimit(clientIp(req), 'art', weight);
    if (limited) {
      res.set('Retry-After', String(limited.retryAfterSeconds));
      return res.status(limited.status).json({ error: limited.error, message: limited.message });
    }
    const book = req.body && typeof req.body === 'object' ? req.body.book || req.body : {};
    if (!isAllowedAudience(book.audience)) {
      return res.status(400).json({ error: 'unsupported_audience', message: 'We only make children\'s books right now.' });
    }
    if (needsScenes) {
      try {
        book.scenes = verifyScenes(req.body.scenesToken);
      } catch (err) {
        console.error('[art] scenes refused:', err.message);
        if (err.code === 'not_configured') console.error('  -> set ORDER_CONFIRM_SECRET in .env; plates cannot be illustrated without it.');
        return res.status(400).json({ error: 'invalid_scenes', message: 'Please write the story again before illustrating it.' });
      }
    }
    try {
      res.json(await handler(book, req.body));
    } catch (err) {
      console.error('[art] failed:', err.message);
      res.status(502).json({ error: 'art_failed', message: 'Could not paint right now.' });
    }
  };
}
```

(`weight` is used by Task 6; passing it now is harmless because Task 6 changes `checkRateLimit` to accept it. Until Task 6 lands the third argument is ignored.)

Change the three art route registrations to:

```js
app.post('/api/generate-cover', artJson, artRoute((book) => generateCoverArt(book)));
app.post('/api/generate-plates', artJson, artRoute((book) => generatePlates(book), { needsScenes: true, weight: PAGE_COUNT }));
app.post('/api/redraw-page', artJson, artRoute((book, body) => redrawPlate(book, body.pageIndex), { needsScenes: true }));
```

and add `const { PAGE_COUNT } = require('./lib/pageCount');` to the requires.

In the `/api/generate-book` handler, replace the two lines that call the generator and respond with:

```js
    const { pages, scenes } = await generateBookPages(book, process.env.ANTHROPIC_API_KEY);
    let scenesToken = null;
    try {
      scenesToken = signScenes(scenes);
    } catch (err) {
      // The story still works without it; only illustrating does not.
      console.error('[generate-book] could not sign scenes:', err.message);
      console.error('  -> set ORDER_CONFIRM_SECRET in .env, or plates cannot be illustrated.');
    }
    res.json({ pages, scenes, scenesToken });
```

Also update the ordering comment above `artJson` (lines ~33-49): replace the parenthetical about `characterSheetUrl` in the comment above `app.use(express.json({ limit: '256kb' }))` so it reads `(photo, photoConsent, coverUrl, plateUrls)`.

- [ ] **Step 6: Mirror in the Vercel twins**

`api/generate-book.js`: add `const { signScenes } = require('../lib/scenesToken');` and replace the success branch:

```js
    const { pages, scenes } = await generateBookPages(book, process.env.ANTHROPIC_API_KEY);
    let scenesToken = null;
    try {
      scenesToken = signScenes(scenes);
    } catch (err) {
      console.error('[generate-book] could not sign scenes:', err.message);
      console.error('  -> set ORDER_CONFIRM_SECRET on this deployment, or plates cannot be illustrated.');
    }
    res.status(200).json({ pages, scenes, scenesToken });
```

`api/generate-plates.js` and `api/redraw-page.js`: add `const { verifyScenes } = require('../lib/scenesToken');` and, after the audience check and before the `try`, insert:

```js
  try {
    book.scenes = verifyScenes(body.scenesToken);
  } catch (err) {
    console.error('[art] scenes refused:', err.message);
    if (err.code === 'not_configured') console.error('  -> set ORDER_CONFIRM_SECRET on this deployment; plates cannot be illustrated without it.');
    res.status(400).json({ error: 'invalid_scenes', message: 'Please write the story again before illustrating it.' });
    return;
  }
```

- [ ] **Step 7: Smoke the routes**

Run (in one shell):

```bash
ORDER_CONFIRM_SECRET=dev PORT=4312 node server.js &
sleep 1
curl -s -X POST localhost:4312/api/generate-plates -H 'content-type: application/json' \
  -d '{"book":{"audience":"child","photo":"data:image/png;base64,iVBORw0KGgo="},"scenesToken":"bad.bad"}'
echo
kill %1
```

Expected: `{"error":"invalid_scenes","message":"Please write the story again before illustrating it."}`

- [ ] **Step 8: Run the whole suite and commit**

Run: `npm test` → PASS

```bash
git add lib/scenesToken.js test/scenesToken.test.js server.js api/generate-book.js api/generate-plates.js api/redraw-page.js
git commit -m "Only illustrate scenes the writer actually wrote"
```

---

### Task 6: Image-weighted rate limit

**Files:**
- Modify: `lib/rateLimit.js` (`BUCKETS.art`, `checkRateLimit` signature and push), `api/generate-plates.js`
- Test: `test/rateLimit.test.js`

**Interfaces:**
- Produces: `checkRateLimit(ip, bucket = 'default', weight = 1)`; the `art` bucket is `{ perIpMax: 30, perIpWindowMs: 10 min, globalMax: 300, globalWindowMs: 1 h }` counted in images.

- [ ] **Step 1: Update the tests**

Replace the existing `art bucket is stricter...` test with:

```js
test('art bucket counts images, not requests: a plates request spends PAGE_COUNT', () => {
  const { PAGE_COUNT } = require('../lib/pageCount');
  const ip = 'test-ip-' + Math.random();
  assert.strictEqual(checkRateLimit(ip, 'art', PAGE_COUNT), null);   // 11
  assert.strictEqual(checkRateLimit(ip, 'art', PAGE_COUNT), null);   // 22
  assert.strictEqual(checkRateLimit(ip, 'art', 1), null);            // 23 (a cover)
  for (let i = 0; i < 7; i++) assert.strictEqual(checkRateLimit(ip, 'art'), null); // 30
  const limited = checkRateLimit(ip, 'art');
  assert.ok(limited && limited.status === 429);
  // default bucket unaffected
  assert.strictEqual(checkRateLimit(ip), null);
});

test('a weighted request that would cross the cap is refused whole', () => {
  const ip = 'test-ip-' + Math.random();
  for (let i = 0; i < 25; i++) assert.strictEqual(checkRateLimit(ip, 'art'), null);
  const limited = checkRateLimit(ip, 'art', 11); // 36 > 30
  assert.ok(limited && limited.status === 429);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/rateLimit.test.js`
Expected: FAIL — the art per-IP cap is still 6 requests.

- [ ] **Step 3: Weight the limiter**

In `lib/rateLimit.js` change the `art` bucket and comment:

```js
  // Art is counted in IMAGES, not requests: one plates request is eleven
  // paid Gemini calls, a cover or a redraw is one. 30 per visitor per ten
  // minutes is two full books plus a handful of redraws; the global ceiling
  // is an hourly image budget per instance.
  art: { perIpMax: 30, perIpWindowMs: 10 * 60 * 1000, globalMax: 300, globalWindowMs: 60 * 60 * 1000 },
```

Change the signature and the two capacity checks and pushes:

```js
function checkRateLimit(ip, bucket = 'default', weight = 1) {
  const config = BUCKETS[bucket] || BUCKETS.default;
  const { perIp, globalHits } = stateFor(bucket);
  const now = Date.now();
  const w = Math.max(1, weight | 0);

  prune(globalHits, config.globalWindowMs, now);
  if (globalHits.length + w > config.globalMax) {
```

```js
  prune(hits, config.perIpWindowMs, now);
  if (hits.length + w > config.perIpMax) {
```

```js
  for (let i = 0; i < w; i++) { hits.push(now); globalHits.push(now); }
```

Update the JSDoc: `@param {number} [weight=1] - how many units this request spends (images for the 'art' bucket).`

- [ ] **Step 4: Pass the weight in the Vercel twin**

In `api/generate-plates.js` add `const { PAGE_COUNT } = require('../lib/pageCount');` and change `checkRateLimit(ip, 'art')` to `checkRateLimit(ip, 'art', PAGE_COUNT)`. (`server.js` already passes `weight: PAGE_COUNT` from Task 5.)

- [ ] **Step 5: Run the suite and commit**

Run: `npm test` → PASS

```bash
git add lib/rateLimit.js test/rateLimit.test.js api/generate-plates.js
git commit -m "Budget illustrations by image, not by request"
```

---

### Task 7: The order carries the whole book and requires the photo

**Files:**
- Modify: `lib/placeOrder.js` (`validateOrder`), `lib/sendOrderEmail.js` (`composeOrderEmail` body)
- Test: `test/placeOrder.test.js`

**Interfaces:**
- Consumes: `PAGE_COUNT`.
- Produces: `validateOrder` adds problems `'No photo of the child.'`, `'Photo consent was not given.'`, `` `The book must have ${PAGE_COUNT} pages.` ``. Email gains a `THE PAGES` section with `  1: <text>` … and `  Cover: <url|missing>`, `  Plate n: <url|missing>` lines.

- [ ] **Step 1: Update the fixtures and add tests**

In `test/placeOrder.test.js`, change `goodBook` to:

```js
const { PAGE_COUNT } = require('../lib/pageCount');
const PHOTO = 'data:image/jpeg;base64,/9j/AAAA';
const goodBook = () => ({
  audience: 'child', direction: 0, title: 'Layla and the door in the garden wall',
  names: 'Layla', tags: ['Dinosaurs'], dedication: 'For Layla, from Baba',
  photo: PHOTO, photoConsent: true, data: { name: 'Layla', age: '7', looks: 'red curly hair' },
  pages: Array.from({ length: PAGE_COUNT }, (_, i) => `Page ${i + 1} text.`),
  coverUrl: 'https://x.public.blob.vercel-storage.com/farsh-art/cover-1.png',
  plateUrls: Array.from({ length: PAGE_COUNT }, (_, i) => (i === 4 ? null : `https://x.public.blob.vercel-storage.com/farsh-art/plate-${i}.png`)),
});
```

Then find the test `the email flags a photo supplied without consent` and change its fixture line that sets `photoConsent: false` so it still composes (composition does not validate), keeping the assertion as is.

Append:

```js
test('an order without a photo is refused', () => {
  const o = goodOrder();
  o.book.photo = null;
  assert.ok(validateOrder(o).some((p) => /photo/i.test(p)));
});

test('an order whose photo consent is not exactly true is refused', () => {
  for (const bad of [false, 'true', 1, undefined]) {
    const o = goodOrder();
    o.book.photoConsent = bad;
    assert.ok(validateOrder(o).some((p) => /consent/i.test(p)), String(bad));
  }
});

test('an order must carry exactly PAGE_COUNT pages of text', () => {
  const o = goodOrder();
  o.book.pages = o.book.pages.slice(0, 3);
  assert.ok(validateOrder(o).some((p) => /pages/i.test(p)));
  o.book.pages = undefined;
  assert.ok(validateOrder(o).some((p) => /pages/i.test(p)));
});

test('the email carries every page, the cover, and each plate or "missing"', () => {
  const o = { ...goodOrder(), orderNumber: 'FA-1234', placedAt: '2026-10-26T10:00:00.000Z' };
  const { text } = composeOrderEmail(o, { secret: SECRET });
  assert.match(text, /THE PAGES/);
  for (let i = 1; i <= PAGE_COUNT; i++) assert.ok(text.includes(`  ${i}: Page ${i} text.`), 'page ' + i);
  assert.match(text, /Cover: https:\/\/x\.public/);
  assert.match(text, /Plate 5: missing/);
  assert.match(text, /Plate 1: https:\/\/x\.public/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/placeOrder.test.js`
Expected: FAIL on the four new tests (and `a complete order validates` still passes).

- [ ] **Step 3: Validate photo, consent and pages**

In `lib/placeOrder.js` add `const { PAGE_COUNT } = require('./pageCount');` and, inside `validateOrder` after the placeholder-name check, add:

```js
  // The book is photographed from the child's photo; without it there is
  // nothing to illustrate, and without consent we must not have it at all.
  // `photoConsent` must be the boolean true — a truthy string from a
  // hand-built request is not a tick in the box.
  if (!str(book.photo)) problems.push('No photo of the child.');
  if (book.photoConsent !== true) problems.push('Photo consent was not given.');
  // The email is the record of what the customer approved. Eleven pages of
  // AI-written text cannot be recreated later, so they must be in the order.
  if (!Array.isArray(book.pages) || book.pages.length !== PAGE_COUNT || !book.pages.every((p) => str(p))) {
    problems.push(`The book must have ${PAGE_COUNT} pages.`);
  }
```

- [ ] **Step 4: Put the pages in the email**

In `lib/sendOrderEmail.js` add `const { PAGE_COUNT } = require('./pageCount');` and, in `composeOrderEmail`, insert before the `''` / `'THE ORDER'` lines:

```js
    '',
    'THE PAGES',
    ...(Array.isArray(b.pages) ? b.pages : []).map((p, i) => `  ${i + 1}: ${String(p || '').trim()}`),
    line('  Cover', b.coverUrl || 'missing'),
    ...Array.from({ length: PAGE_COUNT }, (_, i) =>
      line(`  Plate ${i + 1}`, (Array.isArray(b.plateUrls) && b.plateUrls[i]) || 'missing')),
```

Update the file's header comment to say the email carries the approved page text and art links because they exist nowhere else.

- [ ] **Step 5: Run the suite and commit**

Run: `npm test` → PASS

```bash
git add lib/placeOrder.js lib/sendOrderEmail.js test/placeOrder.test.js
git commit -m "Record the approved pages and pictures in the order, and require the photo"
```

---

### Task 8: Function duration, env and docs

**Files:**
- Modify: `api/generate-plates.js`, `api/redraw-page.js`, `api/generate-cover.js`, `.env.example`, `README.md`, `CLAUDE.md`

- [ ] **Step 1: Declare `maxDuration` on the image functions**

At the top of each of `api/generate-plates.js`, `api/redraw-page.js`, `api/generate-cover.js`, after the requires, add:

```js
// Eleven Gemini calls at concurrency 3 with a 60s abort each can legitimately
// run a couple of minutes; without this Vercel would cut the function off at
// its default and the customer would see a silent "no plates".
module.exports.config = { maxDuration: 300 };
```

Then change `module.exports = async (req, res) => {` to `module.exports = async function handler(req, res) {` and move `module.exports.config = ...` to AFTER the handler definition (assigning `.config` before `module.exports` is reassigned would be lost).

- [ ] **Step 2: Env and docs**

In `.env.example`, extend the `ORDER_CONFIRM_SECRET` comment with: `Also signs the scene lines the writer hands to the illustrator, so the plate routes only illustrate stories we wrote. Required for illustrations.`

In `README.md`:
- Replace the two-line intro with: `A platform for creating personalized hardcover children's books: eleven photorealistic pages and a cover, illustrated from the child's own photo. (Couple and family books exist in the code but are hidden for now — see lib/audiences.js.)`
- In `## Illustrations`, replace the paragraph starting `A builder photo drives the art` with: `The child's photo is required. It is EXIF-stripped and sent as the reference image for the cover and for every page; the cover is sent as a second reference for the pages so clothes stay consistent. Pages are generated three at a time with a 60-second limit each, so a plates request can take a few minutes. Scenes are signed by /api/generate-book (ORDER_CONFIRM_SECRET), so the plate endpoints cannot be used to illustrate arbitrary text.`
- In the `lib/` listing, replace `lib/artPrompts.js` description with `Photorealistic, identity-preserving prompt builders` and add `lib/pageCount.js  The number of story pages` and `lib/scenesToken.js  Signs the scene lines between writer and illustrator`.

In `CLAUDE.md` add under **Rules that matter here**:

```
- **The photo is the identity.** No character sheet: the EXIF-stripped photo
  is the reference for every image. Scenes are signed (`lib/scenesToken.js`)
  so the plate routes cannot illustrate client-written text.
- **Page count lives in `lib/pageCount.js`.** The static pages read
  `pages.length` and keep an eleven-page sample by hand.
```

- [ ] **Step 3: Load check and commit**

Run: `for f in api/*.js; do node -e "require('./$f'); if (typeof require('./$f') !== 'function') process.exit(1)" || echo FAIL $f; done; npm test`
Expected: no FAIL lines; tests PASS.

```bash
git add api/generate-plates.js api/redraw-page.js api/generate-cover.js .env.example README.md CLAUDE.md
git commit -m "Give the illustration functions time to finish, and document the photo rule"
```

---

# Phase 0 — prove Gemini will do it (runs after Task 8, before Phase 2)

### Task 9: Refusal trial on real photos

**Files:**
- Create: `tools/trial-photoreal.js` (throwaway; delete after the trial or leave untracked)

**Interfaces:**
- Consumes: `generateCoverArt`, `generatePlates` (Task 4).

- [ ] **Step 1: Write the script**

```js
// tools/trial-photoreal.js — THROWAWAY. Runs the new photoreal prompts on
// a folder of real child photos and reports refusals, so we know before
// building the UI whether Gemini will illustrate an identifiable child.
//
//   node tools/trial-photoreal.js /path/to/photos
//
// Needs GEMINI_API_KEY (and BLOB_READ_WRITE_TOKEN unset, so images land in
// uploads/generated/). Each photo costs 1 cover + 3 plates.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { generateCoverArt, generatePlates } = require('../lib/generateArt');

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/trial-photoreal.js <photo dir>'); process.exit(1); }

const SCENES = [
  'the child kneels beside a rabbit in a sunlit garden, morning light',
  'the child rides a white pony along a country lane, golden hour',
  'the child reads a large old book at a library table, candlelight',
];

(async () => {
  const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f));
  const rows = [];
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    const mime = /\.png$/i.test(f) ? 'image/png' : 'image/jpeg';
    const book = { audience: 'child', direction: 0, title: 'The trial', photo: `data:${mime};base64,${buf.toString('base64')}`,
      data: { name: 'Child', age: '6', looks: '' }, scenes: SCENES };
    const t0 = Date.now();
    const cover = await generateCoverArt(book);
    const plates = await generatePlates({ ...book, coverUrl: cover.coverUrl }, { concurrency: 3 });
    const got = plates.plateUrls.slice(0, SCENES.length).filter(Boolean).length;
    rows.push({ photo: f, cover: cover.coverUrl ? 'ok' : 'REFUSED', plates: `${got}/${SCENES.length}`, seconds: Math.round((Date.now() - t0) / 1000) });
    console.log(rows[rows.length - 1]);
  }
  console.table(rows);
  const refused = rows.filter((r) => r.cover === 'REFUSED').length;
  console.log(`\n${refused}/${rows.length} covers refused. Open uploads/generated/ and judge likeness by eye.`);
})();
```

- [ ] **Step 2: Run it on about ten real photos**

Run: `node tools/trial-photoreal.js ~/photos-for-trial`
Record: refusal rate, seconds per photo, and whether the plates look like the same child. Also check whether the images came back square (the plate prompt asks for 1:1); if not, add `imageConfig: { aspectRatio: '1:1' }` to `generationConfig` in `genImage` guarded by a `deps.aspectRatio` argument, re-run on two photos, and keep it if the API accepts it.

- [ ] **Step 3: Decide**

If more than about 3 in 10 covers are refused, STOP and report; the identity approach needs redesign before Phase 2. Otherwise continue. Do not commit the script.

---

# Phase 2 — pages

### Task 10: Book Builder requires the photo and keeps generated work

**Files:**
- Modify: `Book Builder.dc.html` — direction blurbs (lines 321-323), photo section markup (lines 139-158), `save()` (372-392), `go()` (544-557), render values for the photo (`showPhotoUpload`, consent copy)

**Interfaces:**
- Produces in localStorage `farsh.book`: all of today's keys, plus any of `pages`, `pagesFor`, `scenes`, `scenesToken`, `coverUrl`, `artFor`, `plateUrls`, `platesFor`, `edits` already present are preserved.

- [ ] **Step 1: Direction blurbs become lighting moods**

Replace the three `child:` entries in `DIRECTIONS` with:

```js
    { key: 'golden', title: 'Golden Hour', blurb: 'Warm low sun, long shadows, meadows and village lanes.' },
    { key: 'moonlit', title: 'Moonlit', blurb: 'Blue night, lanterns and stars. Quiet and dreamlike.' },
    { key: 'kingdom', title: 'Storybook Kingdom', blurb: 'Castle stone, banners, candlelit halls, bright daylight outside.' },
```

- [ ] **Step 2: Photo section copy and consent**

Change the label `Optional — a photo to draw them from` to `Required — one clear photo of their face`. Replace the consent `<span>` text with:

```
I have the right to use this photo and I am this child's parent or guardian. I agree that Farsh! sends it to Google's Gemini image service to create photorealistic pictures of my child for this book, and that those pictures are stored at image links in the order. The photo itself stays in this browser until the order is placed, then it is removed.
```

Add, after the consent label inside the `noPhotoYet` block, a short helper line:

```html
<p style="font-size:12px;line-height:1.5;color:var(--color-neutral-600);margin:0 0 10px;max-width:46ch;">Face the camera, good light, nothing covering the face. Every page is made from this picture.</p>
```

- [ ] **Step 3: Block the step without photo and consent**

In `go()`, after the existing `detailErrors` block inside `if (this.state.step === 2 && clamped > 2)`, add:

```js
      // The whole book is photographed from this one picture, so a book
      // without it is not a book. Consent is checked here too: the file
      // input is disabled until the box is ticked, but a restored book can
      // carry a photo from before the consent text changed.
      if (!this.state.photo || this.state.photoConsent !== true) {
        this.setState({ photoError: this.state.photo
          ? 'Please tick the consent box so we can make the pictures.'
          : 'We need one clear photo of their face to make the book.' });
        const el = document.querySelector('[data-photo-section]');
        if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
```

Add `data-photo-section` to the photo section's outer `<div style="margin-top:18px;padding-top:16px;...">`. Make the `photoError` block render in BOTH branches (`hasPhoto` and `noPhotoYet`): move the `<sc-if value="{{ photoError }}">…</sc-if>` out of the `noPhotoYet` block to directly after it, still inside the section.

- [ ] **Step 4: Save merges instead of rewriting**

Replace `save()` with:

```js
  save() {
    try {
      // Merge over what is already stored. Preview and Checkout write
      // generated fields (pages, scenes, scenesToken, cover, plates, edits)
      // into the same key; rewriting from scratch here threw them away on
      // any visit back to this page and re-billed the story and the art.
      // Only fields this page owns are overwritten.
      let prev = {};
      try { prev = JSON.parse(localStorage.getItem('farsh.book') || '{}') || {}; } catch (e) {}
      localStorage.setItem('farsh.book', JSON.stringify({
        ...prev,
        audience: this.state.audience, direction: this.state.direction,
        // The index alone is meaningless to whoever ends up making the book
        // (it lands in the order email), so carry the name it stands for.
        directionName: (DIRECTIONS[this.state.audience] || [])[this.state.direction]
          ? DIRECTIONS[this.state.audience][this.state.direction].title : '',
        title: this.titleOptions()[Math.min(this.state.titleIdx, 2)],
        names: this.names(), tags: this.state.tags, dedication: this.state.dedication,
        photo: this.state.photo,
        photoConsent: this.state.photoConsent,
        data: this.state.data[this.state.audience] || {},
        // Extra key, read only by this page — Preview and Checkout pick the
        // fields they need by name and ignore it.
        step: this.state.step,
      }));
      if (this.state.saveError) this.setState({ saveError: '' });
    } catch (e) {
      // A photo that does not persist (private mode, quota) means Preview
      // and Checkout will find no photo and refuse the book. Say so.
      if (!this.state.saveError) this.setState({ saveError: 'Your browser is not saving this book (private window or storage full). The photo will be lost when you leave this page.' });
    }
  }
```

Add `saveError: ''` to the initial `state`, expose `saveError: this.state.saveError` in `renderVals()`, and render it next to the Back/Next buttons:

```html
<sc-if value="{{ saveError }}" hint-placeholder-val="{{ false }}">
  <div role="alert" style="font-size:13px;line-height:1.55;color:var(--color-accent-700);font-weight:700;max-width:46ch;">{{ saveError }}</div>
</sc-if>
```

- [ ] **Step 5: Check it parses and behaves**

Run: `node -e "const s=require('fs').readFileSync('Book Builder.dc.html','utf8');for(const b of s.match(/<script[^>]*>([\s\S]*?)<\/script>/g)||[]){const c=b.replace(/^<script[^>]*>/,'').replace(/<\/script>$/,'');if(/src=/.test(b.slice(0,80))||!c.trim())continue;new Function(c.replace(/^\s*import[^\n]*$/mg,'').replace(/^\s*export\s+/mg,''))}console.log('ok')"`
Expected: `ok`

Then with `PORT=4313 node server.js` running, in Playwright: open `/Book Builder.dc.html`, fill the name, click Next without a photo → the photo error is shown and the step does not advance. Seed `localStorage.farsh.book` with `{"audience":"child","pages":["x"],"coverUrl":"c"}` then type into a field → `JSON.parse(localStorage.farsh.book).coverUrl === 'c'`.

- [ ] **Step 6: Commit**

```bash
git add "Book Builder.dc.html"
git commit -m "Ask for the child's photo up front, and stop losing the book on the way back"
```

---

### Task 11: Book Preview shows eleven photographed pages

**Files:**
- Modify: `Book Preview.dc.html` — sample `sets.child` (490-497), `PLATES` (217), `THEME.child.pages` (210), placeholder count (157), copy (145), `componentDidMount` (257-270), `generate()` (399-425), `generateArt()` (462-482), `redrawPage()` (530-548), `spreadHalf` text block (565-580), `xbShow` caption (593), `renderVals` `dirNames`/`title` (695-702), text size (573), `thumbs` (753-764), `onEdit` (744-750)

**Interfaces:**
- Consumes: `/api/generate-book` → `{ pages, scenes, scenesToken }`; `/api/redraw-page` body `{ book, pageIndex, scenesToken }`.
- Produces in `farsh.book`: `scenesToken`, `edits` (object `{ "child:<i>": text }`), `coverUrl`, `artFor`; the photo is never removed.

- [ ] **Step 1: Eleven-page sample story**

Replace the `child:` array in `spreads()`'s `sets` with:

```js
      child: [
        { text: n + ' woke before the sun, which had never happened before. Out of the window the garden wall had a small green door in it, and ' + first + ' was sure it had not been there yesterday. Breakfast could wait. Shoes could not.' },
        { text: 'The door opened onto a path of white stones. ' + first + ' walked it slowly, touching every leaf, counting every butterfly, and found a garden nobody had ever told them about, humming with bees.' },
        { text: 'Under a bush something small was crying. A rabbit, lost and shivering. ' + first + ' knelt down, spoke very quietly, and waited until the rabbit hopped into both hands. "We will find your family," ' + first + ' promised.' },
        { text: 'They did, by the stream. Then the path went on, past hills and little houses, further than ' + first + ' had ever been. It was a long way. ' + first + ' did not once ask how far, which surprised them both.' },
        { text: 'In an old stone library ' + first + ' found a book of maps. One page showed the forest, and in the forest, drawn in careful ink, a dragon. ' + first + ' read that page three times.' },
        { text: 'The dragon was real, and enormous, and asleep in a clearing. When it opened one eye, ' + first + ' stood very still. The dragon did not roar. It sighed. It looked, more than anything, lonely.' },
        { text: 'Its paw was hurt. ' + first + ' wanted to run, and stayed instead, and fetched water, and talked to it about rabbits until the healer came. By evening the dragon was snoring, and ' + first + ' had a friend.' },
        { text: 'That night a storm broke the little bridge by the village. In the morning everyone was carrying stones. ' + first + ' carried stones too, small ones, lots of them, until the road was safe again.' },
        { text: 'One family had lost nearly everything in the rain. ' + first + ' went home, filled a basket, and brought it back without being asked. Nobody said much. Everybody smiled.' },
        { text: 'When ' + first + ' came home, the whole story had got there first. "A real adventurer," said the people who loved ' + first + ' most, "is not the one with the biggest boots. It is the one who stops to help."' },
        { text: 'The door is still there. ' + first + ' checks it every morning, and every so often it is open, and there is always somebody on the other side who needs a hand.' },
      ],
```

Add a comment above `sets`: `// Keep child at eleven entries — mirrors PAGE_COUNT in lib/pageCount.js by hand; the real story drives the count when present.`

Change the map at the end of `spreads()` so the page list length follows the generated story when present:

```js
    const base = sets[a] || sets.child;
    const count = genPages ? genPages.length : base.length;
    return Array.from({ length: count }, (_, i) => {
      const s = base[i] || base[base.length - 1];
      return {
        ...s,
        img: gen[i] || PLATES[i % PLATES.length],
        plate: gen[i] ? 'Photographed for you' : 'Sample page',
        text: this.state.edits[a + ':' + i] || (genPages && genPages[i]) || s.text,
      };
    });
```

(Check the existing map's `plate` label field and keep whatever other fields it sets.)

- [ ] **Step 2: Placeholders, extent, copy**

- `PLATES`: replace the six painted paths with the same six neutral sample photographs already in `uploads/pages/` and `uploads/covers/` (keep the array; placeholders only show before generation).
- `THEME.child.pages: '32 pages'` → `'12 pages'`.
- `hint-placeholder-count="6"` on the thumbs `sc-for` → `"11"`.
- `Final illustrations are painted after you approve` → `Final pictures are photographed after you approve`.
- `redrawLabel`: `'Repainting…'` → `'Taking it again…'`, `'Redraw this picture'` → `'Take this picture again'`.
- `dirNames.child` → `['Golden Hour', 'Moonlit', 'Storybook Kingdom']`.

- [ ] **Step 3: Page numbers instead of chapter headings**

In `spreadHalf`, replace `this.esc(s.chapter)` in the small uppercase label with `'Page ' + (i + 1)`. In `xbShow`, set the caption to `'Page ' + (i + 1) + ' of ' + list.length`. In `thumbs`, set `label: i === list.length - 1 ? 'The end' : 'Page'`.

- [ ] **Step 4: Text that fits**

In `spreadHalf`'s story `<p>`, change the font size to scale with length:

```js
    const size = (s.text || '').length > 420 ? 'clamp(11px,1.25vw,17px)' : 'clamp(13px,1.6vw,22px)';
```

and use `font-size:' + size + ';` in that paragraph's style.

- [ ] **Step 5: Keep the photo, send the token, bounce a no-photo book**

In `componentDidMount`, after the audience clamp and before `this.setState({ audience, book })`, add:

```js
    // A book saved before the photo became required has nothing to be
    // photographed from. Send it back to the Builder's photo step rather
    // than paying for a cover that cannot look like the child.
    if (book && (!book.photo || book.photoConsent !== true)) {
      location.replace('./Book Builder.dc.html?for=child');
      return;
    }
```

In `generate()`, change the `patchBook` call to include the token:

```js
      this.patchBook({ pages: json.pages, scenes: Array.isArray(json.scenes) ? json.scenes : [], scenesToken: json.scenesToken || null, pagesFor: fp });
```

In `generateArt()`, replace the `fields` object and the nulling with:

```js
      const fields = {
        coverUrl: json.coverUrl || null,
        artFor: fp,
        artNote: '',
      };
      // The photo stays. It is the reference for every page, and nulling it
      // here also broke the cover fingerprint so the next visit re-billed.
      this.patchBook(fields);
```

(Remove the `characterSheetUrl` line and the `if (json.characterSheetUrl) fields.photo = null;` line.)

In `redrawPage()`, change the request body to:

```js
        body: JSON.stringify({ book, pageIndex: i, scenesToken: book.scenesToken || null }),
```

- [ ] **Step 6: Edits persist**

In `onEdit`, replace the save branch with:

```js
        if (this.state.editing) {
          const key = a + ':' + this.state.page;
          const text = (this.state.draft || '').trim();
          const edits = { ...this.state.edits, [key]: text || undefined };
          this.setState({ editing: false, edits });
          // Edits are part of the approved book: Checkout sends them in the
          // order, so they must outlive this page.
          this.patchBook({ edits });
        } else {
```

In `componentDidMount`, when setting state from the stored book, restore edits: change `this.setState({ audience, book })` to `this.setState({ audience, book, edits: (book && book.edits) || {} })`.

- [ ] **Step 7: Verify in the browser**

Parse check as in Task 10 Step 5 for `Book Preview.dc.html`. With the server running: seed a book with a photo, consent, and eleven `pages` → Preview shows "Page 1 of 11", thumbs show 11; edit page 3 → `JSON.parse(localStorage.farsh.book).edits['child:2']` holds the text; after a cover is generated (or mocked by setting `coverUrl`), `photo` is still present. Seed a book without a photo → the page redirects to the Builder.

- [ ] **Step 8: Commit**

```bash
git add "Book Preview.dc.html"
git commit -m "Show all eleven photographed pages and keep the customer's edits"
```

---

### Task 12: Checkout illustrates the gaps and sends the whole book

**Files:**
- Modify: `Checkout.dc.html` — `paintPlates()` (486-516), order `fetch` body (744-756), after-order handling (762-766), `onScreenshotPick` (676-693), copy (218, 221), `JOKES` wording if it says "paint"

**Interfaces:**
- Consumes: `/api/generate-plates` body `{ book, scenesToken }` → `{ plateUrls }`; `/api/place-order` body gains `book.pages` (edits applied), `book.coverUrl`, `book.plateUrls`, `book.photo`, `book.photoConsent`.
- Produces in `farsh.book`: `plateUrls`, `platesFor`.

- [ ] **Step 1: Fill the null slots, keyed by a fingerprint**

Replace `paintPlates()` with:

```js
  // Which story+art inputs the current plates were made for. If either
  // changed, the plates are stale and must all be remade; if neither did,
  // only the null slots are retried — eleven calls rarely all succeed.
  platesFingerprint(book) {
    return (book.artFor || '') + '|' + (book.pagesFor || '');
  }

  async paintPlates() {
    const book = this.state.book;
    if (!book || !book.photo || book.photoConsent !== true || !book.scenesToken) return;
    const fp = this.platesFingerprint(book);
    const have = book.platesFor === fp && Array.isArray(book.plateUrls) ? book.plateUrls : [];
    const pages = Array.isArray(book.pages) ? book.pages.length : 0;
    if (pages && have.length === pages && have.every(Boolean)) return;
    this.setState({ painting: true, jokeIdx: 0, plateLimited: false });
    if (!this.reduced()) {
      this.jokeTimer = setInterval(() => this.setState({ jokeIdx: this.state.jokeIdx + 1 }), 1400);
    }
    try {
      let plateUrls;
      if (have.some(Boolean)) {
        // Fill the gaps one page at a time through redraw-page.
        plateUrls = [...have];
        for (let i = 0; i < plateUrls.length; i++) {
          if (plateUrls[i]) continue;
          const res = await fetch('/api/redraw-page', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ book, pageIndex: i, scenesToken: book.scenesToken }),
          });
          if (res.status === 429) { this.setState({ painting: false, plateLimited: true }); return; }
          const json = await res.json().catch(() => ({}));
          if (json.plateUrl) plateUrls[i] = json.plateUrl;
        }
      } else {
        const res = await fetch('/api/generate-plates', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ book, scenesToken: book.scenesToken }),
        });
        if (res.status === 429) { this.setState({ painting: false, plateLimited: true }); return; }
        const json = await res.json().catch(() => ({}));
        plateUrls = Array.isArray(json.plateUrls) ? json.plateUrls : [];
      }
      // Merge over the LATEST this.state.book at write time so this can't
      // clobber fields a concurrent writer set while the request was in flight.
      const updated = { ...this.state.book, plateUrls, platesFor: fp };
      try { localStorage.setItem('farsh.book', JSON.stringify(updated)); } catch (e) {}
      this.setState({ book: updated, painting: false });
    } catch (e) {
      this.setState({ painting: false });
    } finally {
      if (this.jokeTimer) { clearInterval(this.jokeTimer); this.jokeTimer = null; }
    }
  }
```

- [ ] **Step 2: The order payload is the approved book**

Replace the `book: this.state.book,` line in the order `fetch` body with:

```js
              book: this.orderBook(),
```

and add this method next to `orderableBook()`:

```js
  // The email is the only record of the order, so it gets the book exactly
  // as approved: generated pages with the customer's edits applied, plus the
  // cover and whatever plates exist (nulls stay null; the owner sees
  // "missing" and can take those pictures again).
  orderBook() {
    const b = this.state.book || {};
    const edits = b.edits || {};
    const pages = (Array.isArray(b.pages) ? b.pages : []).map((p, i) => edits['child:' + i] || p);
    return { ...b, pages, edits: undefined, scenes: undefined, scenesToken: undefined, artFor: undefined, pagesFor: undefined, platesFor: undefined, step: undefined };
  }
```

Also make `orderableBook()` require pages: find it and add `&& Array.isArray(b.pages) && b.pages.length > 0 && !!b.photo && b.photoConsent === true` to its return condition (keep its existing checks).

- [ ] **Step 3: Downscale the screenshot like the photo**

Add to the component:

```js
  // Vercel caps a function request body at 4.5MB and the order now carries
  // the child's photo as well as this screenshot. Re-encode to a bounded
  // JPEG in the browser, the same way Book Builder does for the photo.
  async downscaleScreenshot(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, err) => {
        const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = url;
      });
      const max = 1600, scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.85);
    } finally { URL.revokeObjectURL(url); }
  }
```

In `onScreenshotPick`, replace the `FileReader` promise with `const dataUrl = await this.downscaleScreenshot(f);` (keep the 5MB pre-check and the error handling).

- [ ] **Step 4: Clear the photo after a successful order, then illustrate**

Plates need the photo, so illustrate first and clear afterwards. In the success branch after `this.paintPlates();`, change to:

```js
          this.paintPlates().then(() => {
            // The consent text promises the photo leaves the browser once the
            // order is placed. The order email has it; this copy is done.
            try {
              const b = JSON.parse(localStorage.getItem('farsh.book') || '{}');
              localStorage.setItem('farsh.book', JSON.stringify({ ...b, photo: null }));
            } catch (e) {}
          });
```

(`paintPlates` already returns a promise because it is `async`.) Note the retry button `onRetryPlates` will then find no photo; change its handler to show the existing `plateLimited` text only when a photo is still present: `onRetryPlates: () => this.paintPlates()` stays, and in `paintPlates` the early `return` when there is no photo is correct behaviour (the owner retakes pictures from the email).

- [ ] **Step 5: Copy**

`Your illustrations are being painted —` → `Your pictures are being taken —`. `The painter is busy —` → `The photographer is busy —`. In `JOKES`, replace any line mentioning painting with a photography one, e.g. `'Asking the dragon to hold still for the camera...'`.

- [ ] **Step 6: Verify in the browser**

Parse check as in Task 10 Step 5. With `ORDER_CONFIRM_SECRET=dev` and no Gemini key, seed a complete book (photo, consent, 11 pages, scenesToken from a real `/api/generate-book` call or any string) and a screenshot; place an order with Resend unconfigured → the page shows the loud order failure (expected without Resend). Then with `RESEND_API_KEY`/`ORDER_EMAIL_TO` set to a test inbox, place an order → the email has `THE PAGES` with eleven lines and `Plate n: missing` for each, and `localStorage.farsh.book.photo` is `null` afterwards.

- [ ] **Step 7: Commit**

```bash
git add Checkout.dc.html
git commit -m "Send the approved book with the order, and finish any pictures that failed"
```

---

### Task 13: Landing copy

**Files:**
- Modify: `Landing Page.dc.html` lines 153, 156 (`32 illustrated pages`), 745 (FAQ)

- [ ] **Step 1: Edit**

- Both `32 illustrated pages` → `12 photographed pages`.
- FAQ `Can it look like my child?` answer → `Yes — that is the whole point. Send one clear photograph, face to the camera in good light, and every page is photographed from it: their face, their hair, their glasses. A photo is required; we cannot make the book without one.`

- [ ] **Step 2: Commit**

```bash
git add "Landing Page.dc.html"
git commit -m "Say plainly that every book is photographed from one photo"
```

---

### Task 14: End-to-end browser check

**Files:** none modified.

- [ ] **Step 1: Run the suite**

Run: `npm test` → all PASS, no warnings.

- [ ] **Step 2: Walk the flow in Playwright**

With `ORDER_CONFIRM_SECRET=dev PORT=4314 node server.js`:

1. Landing → no console errors; CTA goes to `Book Builder.dc.html?for=child`.
2. Builder → cannot pass step 2 without a photo; upload a photo and tick consent → step 3 and 4 work; the stored book keeps `photo`.
3. Preview → eleven pages, "Page 1 of 11"; with no `ANTHROPIC_API_KEY` the sample story has eleven pages; with one, the real story arrives with `scenesToken` set.
4. Preview → edit page 9, reload → edit survives; "Take this picture again" posts `scenesToken`.
5. Checkout → order button disabled until a screenshot is picked; after a (configured) order, the confirmation shows "pictures are being taken", and the photo is cleared from storage afterwards.
6. Seed a book without a photo → Preview and Checkout both bounce/refuse.

Expected: zero console errors on all pages.

- [ ] **Step 3: Report**

Summarise test counts, the Phase 0 refusal numbers, and anything left null (plates with no Gemini key) in the handoff message.

---

## Self-review

**Spec coverage.** Page count (T1), story rules/budget/short-throw (T2), photoreal prompts + identity + clamps + moods + ratios (T3), sheet deleted + photo/cover refs + concurrency/abort/429 + redraw clamp + own-host check (T4), signed scenes + fail-loud without secret (T5), weighted art bucket (T6), photo/consent/pages required + email pages section (T7), `maxDuration`, env, README, CLAUDE.md (T8), Phase 0 trial incl. aspect-ratio probe (T9), Builder required photo/consent copy/mood blurbs/merging save/save error (T10), Preview 11 sample pages, page numbers, copy, photo kept, token stored and sent, no-photo bounce, edits persisted, text scaling, placeholders (T11), Checkout gate, fill-null-slots with `platesFor`, full payload, screenshot downscale, photo cleared, copy (T12), Landing copy (T13), browser check (T14). Spec item "aspectRatio set if supported" is conditional on T9 and lives there.

**Placeholders.** None: every code step has its code; the Phase 0 script is explicitly throwaway.

**Type consistency.** `PAGE_COUNT` (T1) used by T2, T4, T5, T6, T7, T12 (as `pages.length`). `generateCoverArt → { coverUrl, usedPhoto }` (T4) matches Preview's `fields` (T11). `generatePlates(book, deps)` with `book.scenes` set by the route from `verifyScenes` (T5) matches T4's `plateFor`. `scenesToken` flows generate-book (T5) → Preview `patchBook` (T11) → Checkout bodies (T12) → plate routes (T5). `checkRateLimit(ip, 'art', weight)` (T6) matches `artRoute`'s call (T5). `book.edits` keys `'child:<i>'` (T11) match `orderBook()` (T12). `validateOrder` requires `pages`, `photo`, `photoConsent === true` (T7) and `orderBook()` supplies them (T12).
