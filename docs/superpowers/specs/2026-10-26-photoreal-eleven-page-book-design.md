# Photoreal, eleven-page child book — design

**Status:** approved in conversation on 2026-10-26, after an ECC architect
review of the first draft. This is the amended design.

## Goal

Adopt the owner's "master prompt" for the book as far as it maps onto the
site. The site keeps writing an open-ended story from the child's own details;
what changes is the length, the tone rules, the art style, and how the child's
real face gets into every picture.

Decisions already made by the owner (not open):

- Stories stay **open-ended**, written from what the parent typed. Not one
  fixed story.
- A **photo is required** for every book, with consent.
- Art is **photorealistic cinematic** (film-still look), not painted.
- **Cover + 11 story pages**, 50–90 words per page.
- **No PDF.** The web preview stays the proof; the order email is the record.

Only the child book is sold (`lib/audiences.js`); couple/family stay dormant.

## Phase 0 — prove Gemini will do it

Before any UI work: a throwaway script runs the new cover and plate prompts
against ~10 real child photos through `lib/generateArt.js` and reports, per
photo, whether Gemini returned an image or refused. Photorealistic images of
an identifiable child are the likeliest request to trip `IMAGE_SAFETY`. If
refusals are common, stop and redesign the identity step before building
Phase 2. Nothing from this phase is kept.

Two things the review could not verify and this phase settles: whether the
image model accepts an aspect-ratio setting in `generationConfig`, and
whether Google restricts photos of children in some regions.

## Phase 1 — server and prompts

### Page count

`lib/pageCount.js` exports `PAGE_COUNT = 11` (story pages; the cover is
separate). It replaces every hard-coded 6 in lib: the story schema and
`normalizePages`, the plates loop, and the redraw clamp. The static pages
cannot import it (no build step), so the front end reads `pages.length` from
the generated book and the sample story is kept at 11 by hand, with a sync
comment pointing here — the same convention as `artFingerprint`.

### Story (`lib/generateBook.js`)

- Eleven generic beats replace the six chapter beats: a wish, exploring,
  helping a small creature, a journey, a discovery, meeting something large,
  staying brave, helping the community, a gift, recognition, the ending.
  The beats are a story shape, not a plot: the child can be a princess, a
  pirate, or a vet depending on the details given.
- Rules carried from the master prompt: 50–90 words per page, read-aloud
  tone, short sentences, the child *doing* something on every page, no page
  that is just a portrait, kindness/courage/helping as the backbone, and
  the ending looking forward.
- Each page still returns `{ text, scene }`. The scene brief is written for a
  photographer, not a painter: location, action, time of day, lighting.
- `max_tokens` rises from 2048 to 6000. Eleven pages of 90 words plus scenes
  does not fit 2048 and a truncated JSON currently 502s into the sample story.
- `normalizePages` no longer pads a short result by repeating the last page
  (eleven pages makes two copies of the ending likely). Fewer than
  `PAGE_COUNT` pages throws `generation_short`; the route maps it to 502 and
  the page falls back to the sample story as it does for any failure.
- The sample story (no key) becomes 11 pages, matching the beats.

### Art prompts (`lib/artPrompts.js`)

- `CONSTRAINTS` and `BASE_MEDIUM` flip to the master prompt's Part 2:
  photorealistic, cinematic, real skin and hair texture, physically
  plausible light, natural proportions, no cartoon/anime/3D/doll look, no
  beauty filter, no text or borders in the image, one scene per image.
- The three child "directions" become lighting moods of the same look:
  Golden Hour, Moonlit, Storybook Kingdom. Couple/family style blocks are
  left as they are (dormant).
- Identity block, used by cover and plates: the attached photograph is the
  child; keep face shape, hairline, hair texture, eyes, nose, lips, skin
  tone, apparent age; never age up; clothing, pose, expression, scene may
  change; if identity conflicts with the scene, identity wins.
- Cover: portrait 3:4, calm top third for the title. Plates: square 1:1,
  the child clearly visible, calm negative space on one side.
- **Every field that reaches Gemini is clamped** with the same `clamp()`
  discipline as `generateBook.js`: `scene` (300), `title` (200), `looks`
  (300), `age` (10). Today `platePrompt` and `coverPrompt` do not clamp.
- `aspectRatio` is set in `generationConfig.imageConfig` if Phase 0 shows
  the model honours it; otherwise prompt text only.

### Identity reference (`lib/generateArt.js`)

- **The character sheet is deleted**, not renamed: `characterSheetPrompt`,
  `photoSheetPrompt`, `sheetPartFor`, `sheetBytesB64`, and
  `characterSheetUrl`. Deleting `sheetPartFor` removes a server-side request
  forgery (it fetched any client-supplied URL) and deleting `sheetBytesB64`
  removes a production-reachable path that skipped EXIF stripping.
- The **original photo** (EXIF-stripped per call, as now) is the primary
  reference for the cover and for every plate.
- The **cover is the secondary reference** for plates, so clothes and hair
  stay consistent across eleven separate calls. The server fetches it only
  if its host is the configured Blob host (or a local `uploads/generated`
  path, containment-checked as today); anything else is ignored and the
  plate is drawn from the photo alone.
- `generateCoverArt` returns `{ coverUrl, usedPhoto }`. With the photo
  required there is no description-only fallback; a refused photo yields
  `coverUrl: null` and the typeset cover stays.
- `generatePlates` runs the eleven calls with **concurrency 3**, each attempt
  under a 60-second `AbortSignal`. A 429 from Gemini backs off once before
  the retry instead of retrying immediately. Null slots stay null; the
  client fills them through `/api/redraw-page`.
- `redrawPlate` clamps `pageIndex` to `PAGE_COUNT - 1`.
- `api/generate-plates.js` and `api/redraw-page.js` declare
  `maxDuration` (300) so Vercel does not cut the request at the default.

### Scenes are not trusted from the client

`/api/generate-plates` and `/api/redraw-page` with a photo and client-written
scenes would be a public photoreal face-swap service. `generate-book`
therefore returns, alongside `pages` and `scenes`, a `scenesToken`: an HMAC
over the scenes array signed with `ORDER_CONFIRM_SECRET` (reusing
`lib/orderToken.js`'s sign/verify). The plate routes verify the token
against the scenes they are given and refuse with 400 `invalid_scenes` on
mismatch. Without the secret configured, plate routes refuse (same
fail-loud posture as the confirm link).

### Rate limit (`lib/rateLimit.js`)

`checkRateLimit(ip, bucket, weight = 1)`. The `art` bucket counts images,
not requests: cover = 1, plates = `PAGE_COUNT`, redraw = 1. Per-IP allowance
becomes 30 images / 10 min (two full books plus redraws); global 300 images /
hour. Worst case spend is bounded by images, not by request count.

### The order email records the book (`lib/sendOrderEmail.js`)

The email is the order record, but today it carries no story. It gains a
`THE PAGES` section: every page's final text (customer edits applied), the
cover URL, and the eleven plate URLs (or `missing` per slot). `placeOrder`
requires `book.pages` of length `PAGE_COUNT`, a photo, and
`photoConsent === true`; it rejects otherwise with `invalid_order`.

### Order body size

`api/place-order.js` on Vercel has a 4.5 MB request cap. Checkout's payment
screenshot allows 5 MB (≈6.7 MB as base64) and the photo now rides along
too. Checkout downscales the screenshot in the browser the way it already
downscales the photo (longest side 1600px, JPEG), so an order is ~1 MB.

## Phase 2 — pages

### Book Builder

- The photo step requires a photo **and** the consent box; "Next" is blocked
  with the existing inline error pattern until both are set.
- Consent text says plainly: photorealistic images of the child are
  generated from this photo by Google's Gemini and stored at public image
  URLs for the order; the photo itself is kept in this browser until the
  order is placed, then removed.
- Direction blurbs describe the three lighting moods, not painted styles.
- `save()` merges over the stored book instead of rewriting it, so
  `pages`, `pagesFor`, `coverUrl`, `artFor`, `plateUrls`, `platesFor` and
  `edits` survive a visit back to the Builder. (Today any Builder visit
  re-bills the story and the cover.)
- A saved-photo write that fails (private mode, quota) shows an error
  instead of being swallowed; the photo gate downstream depends on it.

### Book Preview

- Pages come from `book.pages.length`; the sample story has 11.
- Chapter headings are replaced by "Page n of 11" in the caption and
  thumbnails. Placeholder counts, "32 pages" extent, and "final illustrations
  are painted" copy are corrected.
- The photo is **never nulled** after the cover is made, and is **sent** with
  the redraw request. (The nulling also broke the cover fingerprint and
  re-billed a description cover on the next visit.)
- A book with no photo (saved before this change) is sent back to the
  Builder's photo step instead of auto-generating a cover.
- Customer **edits persist** into `book.edits` in localStorage and are
  applied when the order is placed.
- The text panel scales font size down for long pages instead of clipping
  at `overflow: hidden`.
- Placeholder `PLATES` art is replaced with neutral photographic placeholders
  so a half-generated book does not mix painted and photoreal pages.

### Checkout

- `paintPlates` gate: `photo && photoConsent`, not cover presence. The
  request sends the photo and the cover URL. The guard is "fill the null
  slots", keyed by a `platesFor` fingerprint of (art fingerprint + `pagesFor`),
  so a regenerated story repaints and a partial failure can complete.
- The order payload carries `pages` (edits applied), `coverUrl`,
  `plateUrls`, the photo and consent, and the downscaled screenshot.
- After a successful order the photo is removed from localStorage.
- "Being painted" copy becomes "being photographed".

### Landing

- "Skip the photograph… works just as well" (FAQ) becomes "a clear photo is
  required; here is what makes a good one".
- "32 illustrated pages" becomes "12 pages".

## Error handling

Unchanged posture: missing keys degrade to the sample story and typeset
cover; a refused or failed image is a null slot the customer can redraw; a
failed order fails loudly. New expected errors: `generation_short` (502),
`invalid_scenes` (400), `unsupported_audience` (400, already in place).

## Testing

- `test/pageCount.test.js`: constant is 11.
- `test/generateBook.test.js`: prompt names 11 beats and the 50–90 rule;
  schema and `normalizePages` use `PAGE_COUNT`; short output throws;
  `max_tokens` ≥ 6000 (assert on the request the mocked client sees).
- `test/artPrompts.test.js`: photoreal constraints present, "never
  photorealistic" absent; identity block in cover and plate prompts; every
  user field clamped; three child moods; 1:1 / 3:4 wording.
- `test/generateArt.test.js`: sheet paths gone; photo is the first reference
  part on cover and plates; cover becomes second part when its host is the
  Blob host and is ignored otherwise; concurrency ≤ 3 observed via a counting
  fetch; abort fires on a hung fetch; 429 backs off; redraw clamps to 10.
- `test/rateLimit.test.js`: weights; plates request spends 11.
- `test/placeOrder.test.js`: photo and consent required; pages required;
  email carries pages and plate URLs.
- `test/scenesToken.test.js`: tamper and mismatch refused.
- Browser check (Playwright) on the four pages: no console errors; a
  no-photo book bounces to the Builder; redraw works on page 9.

## Out of scope

PDF generation; Arabic/RTL; a database; any change to couple/family code;
payment beyond the InstaPay screenshot already in progress.
