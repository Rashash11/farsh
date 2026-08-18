# AI Illustrations for Farsh Books — Design

Date: 2026-08-18
Status: Approved (design), pending implementation plan

## Problem

Text generation is personalized (`/api/generate-book` → Claude writes 6
page texts from Book Builder data), but every book shows the same 6
stock plates and a typeset-only cover regardless of the story. A book
about "Nova and the dragon" shows a picture of a bedroom window. The
product promise — "we write and illustrate a full hardcover book with
them in it" — is only half real.

## Decisions (locked with the owner)

| Decision | Choice |
| --- | --- |
| Image provider | Google Gemini image API (`GEMINI_API_KEY` in `.env`) |
| Generation trigger | Hybrid: character sheet + cover at preview; 6 page plates after purchase |
| Audiences in v1 | All three (child, couple, family) — family is description-only, no photo |
| Storage | Vercel Blob for generated art; URLs saved into the existing localStorage book object |
| Photo upload | Yes in v1 (child: 1 photo, couple: up to 2, family: none) with strict guardrails |
| Edit policy | Text edits never regenerate art; per-page "Redraw this picture" button |

## Architecture

```
Book Builder ──(details + optional photo)──► POST /api/generate-cover
    1. character sheet (photo-based or description-based)      │
    2. cover art (character + title scene)                     ▼
                                              Gemini ──► Vercel Blob ──URLs──► book object

Checkout "Place order" ──► POST /api/generate-plates   (6 page illustrations)
Preview "Redraw" button ──► POST /api/redraw-page       (single page, on demand)
```

### New/changed modules

- **`lib/generateArt.js` (new)** — Gemini image client. Owns:
  - `STYLE_BLOCKS`: one versioned style constant per direction
    (child: Midnight Magic / Scrapbook / Toybox; couple: Midnight
    Velvet / Letter Press / Paper Garden; family: Kitchen Table /
    Album / Long Table).
  - Prompt builders: character sheet (description path and photo
    path), per-page plate, cover.
  - Output validation (dimensions, format, our own "must be
    illustrated, not photorealistic" check), one retry, then fallback.
  - Blob upload; returns URLs.
- **`lib/generateBook.js` (small change)** — Claude's JSON schema
  becomes `{ pages: [{ text, scene }] }`. `scene` is a one-line visual
  brief for that page, grounded in the story it just wrote. Frontends
  that only read `text` keep working.
- **`server.js`** — three new endpoints (below), all behind the
  existing `checkRateLimit` with a stricter budget for image routes.
- **Vercel deploy** — same endpoints as serverless functions under
  `api/`; requires the Blob integration (`BLOB_READ_WRITE_TOKEN`).

### Endpoints

| Endpoint | When | Does |
| --- | --- | --- |
| `POST /api/generate-cover` | Preview load (with text gen) | Character sheet + cover; returns `{characterSheetUrl, coverUrl}` |
| `POST /api/generate-plates` | After "Place the order" | 6 plates using the character sheet as reference; returns `{plateUrls[]}` |
| `POST /api/redraw-page` | "Redraw this picture" button | One plate; returns `{plateUrl}` |

All accept the existing book object; photo (when present) rides along
as multipart on `/api/generate-cover` only.

### Fingerprints & caching

Two independent fingerprints stored on the book object:

- `pagesFor` (existing): text inputs → controls text regeneration.
- `artFor` (new): `{audience, direction, looks, age, photoHash}` →
  controls art regeneration. Name-only changes re-run text, not art.
  Appearance/direction changes invalidate `artFor` (character sheet,
  cover, and plates).

### Failure model

Any image failure — API down, refusal, timeout, invalid output — falls
back to the current stock plate/typeset cover for that slot only. The
book can never fail to render. Refusal of an uploaded photo falls back
to the description-based character sheet automatically, with a gentle
UI note ("we illustrated from your description instead").

## Photo path guardrails (non-negotiable in implementation)

1. Consent checkbox required before upload: "I have the right to use
   this photo and consent to it being used once to illustrate this
   book."
2. Photo held **in memory only** (multer memory storage). Never
   written to Blob, disk, or logs. Discarded after the character-sheet
   call. EXIF stripped before sending.
3. Output must be a painted illustration. The prompt demands it and
   our validation rejects photorealistic output of the character —
   independent of the provider's own filters.
4. The pipeline never depends on the photo path succeeding (see
   failure model).
5. FAQ copy stays accurate: keep the "send one clear photograph" line,
   and it now becomes true.

## Prompt architecture

Every image prompt = STYLE BLOCK + CHARACTER BLOCK + SCENE BLOCK +
CONSTRAINTS BLOCK.

**Constraints (all prompts):** "Painted storybook illustration only —
never photorealistic. No text, letters, numbers, borders, or
watermarks in the image. Single coherent scene."

**Character sheet, description path (child):**

> Children's picture-book character reference sheet, painted storybook
> illustration (gouache + colored-pencil texture, visible brushwork,
> warm golden light — classic 1970s Scholastic paperback style).
> Character: a {age}-year-old child, {looks}. Cheerful, expressive
> face. Simple timeless clothes with {direction accent} accents.
> Show the SAME character 4 times on one sheet: front view, side view,
> running pose, delighted close-up. Plain cream background.
> {CONSTRAINTS}

**Character sheet, photo path:** image-to-image with the uploaded
photo:

> Transform the person in this photo into a painted storybook
> character: preserve hair style and color, skin tone, and glasses if
> present. Fully illustrated with gouache texture — not a photo
> filter, not photorealistic. Same 4-pose reference sheet layout.
> {STYLE BLOCK} {CONSTRAINTS}

**Couple:** one sheet containing both characters side by side —
generating them together is what keeps them consistent as a pair.
Photo path accepts up to 2 photos, one per partner.

**Family:** Claude distills the "who is in it" field into a short cast
list (name/age/one visual trait each) during story generation; the
sheet prompt draws the cast lineup. No photos in v1.

**Per-page plate (×6):** character sheet attached as reference image:

> Using the attached character reference sheet, illustrate this exact
> character (same face, hair, glasses, clothes) in a new scene.
> Scene: {scene from the story JSON}.
> {STYLE BLOCK} Landscape 4:3. {CONSTRAINTS}

**Cover:** same as a plate but portrait 3:4, composition keeps the top
third calm/open because the site typesets the title over it, scene
matches the chosen title.

## Frontend changes

- **Book Builder step 2**: optional photo upload (child 1 / couple 2)
  with consent checkbox; thumbnail preview; remove button.
- **Book Preview**: cover panel shows generated cover art when
  available (typeset title overlaid as today); page plates stay stock
  with a small caption "final illustrations are painted after you
  approve"; per-page "Redraw this picture" button appears only when a
  generated plate exists; the existing loading-joke rotation covers
  cover generation (~15–30s).
- **Checkout confirmation**: after "Place the order", plates generate;
  confirmation shows "Your illustrations are being painted…" with the
  joke rotation; the small confirmation cover swaps to the real cover
  art when it exists; book object updates with plate URLs as they
  arrive.

## Costs (estimates, for expectations only)

- Previewed book: character sheet + cover ≈ 2 images ≈ $0.05–0.30.
- Purchased book: +6 plates ≈ $0.25–0.80.
- Abandoned previews only ever cost the preview step — that is the
  point of the hybrid trigger.
- Redraw button: one image per click, rate-limited.

## Testing

- **Prompt snapshot tests**: prompt builders are pure functions;
  fixture book objects (3 audiences × 3 directions, with/without
  photo, with/without looks) snapshot the exact prompts.
- **Failure-mode tests** (Gemini mocked): refusal → fallback slot;
  timeout → fallback; wrong dimensions → one retry then fallback;
  photo refusal → description-path fallback + flag in response.
- **Fingerprint tests**: name change does not invalidate `artFor`;
  looks/direction change does.
- **Live smoke test**: one child book end-to-end against the real API
  (guarded by env var so CI never spends money).
- **Manual visual QA checklist**: same face across 6 plates; style
  matches direction; no text baked into images; cover top-third clear.

## Out of scope (v2 candidates)

- Family photo uploads / group-photo likeness.
- Regenerating art styles after purchase ("repaint in Toybox").
- Print-resolution upscaling pass for the actual physical book.
- Per-page art editing beyond redraw (e.g. "make the door red").
