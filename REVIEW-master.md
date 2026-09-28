# Farsh! — review of `origin/master` (95a2218)

Method: `npm install && npm test` (23/23 pass), read `server.js`, `lib/*`, `api/*`,
ran the server on :4100 and probed it, drove the site in Chromium at 1440×900 and
390×844. Every claim below was observed, not inferred.

**Overall this is good code.** The README is honest about what's real vs simulated,
the comments explain *why* rather than *what*, the failure paths degrade to nulls
instead of throwing, and the tests cover the things that actually matter (path
traversal, refusal fallback, EXIF). The findings below are narrow.

---

## P0 — Rate limiting is bypassable, which is a cheap DoS on a paid service

The limiter is the thing standing between a stranger and your Anthropic/Gemini
bill, and its per-IP layer can be stepped around by setting a header.

**Demonstrated locally** against `server.js` on :4100:

```
same X-Forwarded-For, 8 requests:      400 400 400 400 400 429 429 429
rotating X-Forwarded-For, 8 requests:  400 400 400 400 400 400 400 400
```

(400 = passed the rate check and failed later on the missing API key. The limit
is `perIpMax: 5`.)

The deployed path has the same weakness for a different reason. `api/*.js` derive
the client IP as:

```js
const fwd = req.headers['x-forwarded-for'];
const ip = (typeof fwd === 'string' && fwd.split(',')[0].trim()) || ...
```

`split(',')[0]` takes the **leftmost** entry. Vercel appends the real client IP to
the right of whatever the client sent, so the leftmost value is attacker-supplied.
Every request with a fresh fake IP gets its own allowance.

**The global bucket does hold** — verified, the 61st request in the window 429s
exactly as designed:

```
47 × 400, 13 × 429   — first 429 at request #48 (13 already spent earlier = 60)
```

So this is not unbounded spend. The real damage is different: **one person with a
shell loop can burn the entire hourly global budget in seconds**, and every
genuine customer for the rest of that hour gets *"The writer is fully booked right
now."* On a business taking real orders, that's a denial of service that costs the
attacker nothing.

**Fix**: on Vercel read `x-vercel-forwarded-for` (or `x-real-ip`), which the
platform sets and the client cannot forge; never trust the leftmost `x-forwarded-for`.
For the Express path, `req.ip` with `trust proxy` set to the actual number of
proxies in front is already correct — the local bypass above is because there is no
real proxy in front of it in dev.

---

## P1 — Prompt input has no length cap, so cost per request is attacker-controlled

`buildPrompt()` interpolates `book.names`, `book.title`, `book.dedication`,
`book.tags` and every `data[key]` straight into the prompt with no truncation. The
app-wide body limit is 256kb, so a single request can carry ~250KB of text into a
`claude-opus-5` call — roughly 60k tokens instead of the ~500 a real book needs.
`max_tokens: 2048` caps the *output*; nothing caps the input.

Combined with the finding above, 60 requests/hour × 60k tokens is a much larger
bill than the limiter's author was budgeting for. The rate limiter counts
*requests*; it should also bound *size*.

**Fix**: clamp each interpolated field (names 100 chars, title 200, dedication 500,
each `data` value 300, tags to ~10 entries) in `buildPrompt`. Cheap, and it makes
the per-request cost predictable.

---

## P1 — EXIF stripping is gated on a client-declared MIME type

`lib/stripExif.js` opens with the right principle:

> *"Defense-in-depth: the client already re-encodes photos via `<canvas>` (which
> drops EXIF), but the server must not rely on the client."*

But the call site re-introduces exactly that reliance — `lib/generateArt.js:35`:

```js
if (m[1] === 'image/jpeg') buf = stripExif(buf);
```

`m[1]` is the MIME type out of the client's own data URL. A request declaring
`data:image/png;base64,<jpeg bytes with GPS EXIF>` skips stripping entirely and the
metadata goes to Gemini. Separately, `stripExif` is JPEG-only by construction, so a
genuine PNG carrying an `eXIf` chunk is passed through untouched.

In practice today the client always sends `canvas.toDataURL('image/jpeg')`, so the
normal path is stripped. This is the defense-in-depth layer failing, not a live
leak — but these are photographs of children, so the layer is worth having.

**Fix**: sniff the magic bytes rather than trusting the declared type, and either
handle PNG metadata chunks or reject non-JPEG uploads outright.

---

## P2 — Smaller things

1. **`express.static(__dirname)` serves the whole project.** `server.js`,
   `lib/*.js`, `test/*`, `docs/*`, `package.json` and all of `node_modules/` are
   readable over HTTP. Dotfiles *are* protected — `/.env` and `/.git/config` both
   404, confirmed — and `.vercelignore` keeps `server.js`, `docs`, `tools` and
   `.env*` out of the deploy, so this is dev-only today. It becomes real the moment
   the Express server runs anywhere but localhost.
2. **`server.js` leaks `detail: err.message` to the client** on generation failure;
   the `api/` twin deliberately doesn't. Make them match — the twin is right.
3. **`normalizePages` pads a short generation by duplicating the last page**
   (`items.push(items[items.length - 1])`). That turns a model hiccup into a
   printed, shipped book with two identical final pages. For something physical and
   unreturnable, failing loudly and retrying beats silently padding.

---

## P2 — Accessibility

The interaction layer is in good shape and much better than it looks from the
outside: **zero** non-semantic clickables, 41 focusables on the landing page, a
sensible heading order (`H1,H2,H2,H2,H2,H3,H3,H3,H2…`), and a skip link. Whoever
moved the pickers to real `<button>`s did the hard part.

What's missing is the cheap part, and it's missing on all four pages:

| Gap | Pages affected | Criterion |
|---|---|---|
| No `<title>` | Builder, Preview, Checkout, Landing | 2.4.2 (A) |
| No `lang` attribute | all four | 3.1.1 (A) |
| No `<main>` landmark | all four | 1.3.1 (A) |
| No `aria-live` anywhere — generation takes seconds and announces nothing | all four | 4.1.3 (AA) |
| One unlabeled input (the hero "type their name" field) | Landing | 3.3.2 (A) |
| No meta description | all four | — (SEO) |
| 13 of 38 touch targets under 44px at 390px (mostly 40–41px tall; footer links 22px) | Landing | 2.5.8 (AA) |

No horizontal overflow at 390px.

The `aria-live` one is worth more than its row suggests: `/api/generate-book` is a
multi-second call, and a screen-reader user currently gets no indication that
anything is happening or that it finished.

---

## P2 — No RTL, and MENA is the primary market

Zero occurrences of `rtl` across `Book Builder.dc.html`, `Book Preview.dc.html`,
`Checkout.dc.html` and `Landing Page.dc.html`. No `dir` attribute, no logical CSS
properties, no Arabic UI strings.

`_ds/modernist-*/styles.css` and its custom properties are the natural place to
handle this, and doing it there while the design system is young is far cheaper
than retrofitting it across four pages of inline styles later.

---

## One question, not a finding

The landing page states **"★ 4.9 from 2,300 parents"** and **"2,300 reviews"**. If
those numbers are real, ignore this. If they're placeholder copy, they're the kind
of placeholder that turns into a consumer-protection problem the day the site goes
public — worth changing before launch rather than after.

---

## Not found

For completeness, things I checked for and did not find: no hardcoded secrets, no
SQL (no database), no `eval`/`Function` construction, no `dangerouslySetInnerHTML`
equivalent in the dc templates, no SSRF (the only outbound calls are to fixed
Anthropic/Gemini endpoints), and the path-traversal guard on `characterSheetUrl`
is present and tested in both directions.
