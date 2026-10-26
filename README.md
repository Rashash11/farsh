# Farsh! — personalized book platform

A platform for creating personalized hardcover children's books: eleven photorealistic pages and a cover, illustrated from the child's own photo. (Couple and family books exist in the code but are hidden for now — see `lib/audiences.js`.)

## Running it

```bash
npm install
cp .env.example .env      # then paste your Anthropic API key into .env
npm start
```

Open **http://localhost:4000** (redirects to the landing page).

That's the whole setup. With a key in `.env`, going through **Build my kid's
book** → filling in step 2 (their name/age/looks/loves) → **Read the whole
book** on step 4 writes a real, personalized 6-page story with Claude and
shows it on the Book Preview page. Without a key, the site still works
exactly as before — Book Preview shows its original sample story instead,
with a small note that generation isn't configured.

Restart the server (`npm start`) after adding or changing the key — it's
read from `.env` once at startup.

## What's real vs. simulated

- **Story text** is real — written by Claude per the details you enter in
  the builder (name, age, what they look like, what they love, etc.), via
  `POST /api/generate-book`.
- **"Place the order" on Checkout is real, except payment.** It validates the
  order server-side, emails the full order to `ORDER_EMAIL_TO` via Resend,
  and only then returns a real order number — that email *is* the order
  record. No card is ever charged; no payment processing is wired up.
- **Cover and page art** is real too, when `GEMINI_API_KEY` is set — see
  "Illustrations" below. Without a key, covers and pages show the original
  typographic art, same silent fallback as story generation.

## Illustrations

Three endpoints take the pictures: `POST /api/generate-cover` (on Preview,
once the story is written), `POST /api/generate-plates` and
`POST /api/redraw-page`. The pages are taken on Checkout when the page loads,
before the order is sent, and the order is refused (in the browser and again
in `lib/placeOrder.js`) until every picture exists: the child's photo is
removed after the order, so nothing missing could be taken later. A picture
that failed can be retried from Checkout ("Try the pictures again"). The cover
may fall back to the typeset cover; that is honest stock content and does not
block the order.

The child's photo and the parent's consent are required. The photo is
EXIF-stripped and sent as the reference image for the cover and for every
page; the cover is sent as a second reference for the pages so clothes stay
consistent. Pages are generated three at a time with a 60-second limit each,
so a plates request can take a few minutes; no new page starts after about two and a half
minutes, to keep the request (and the pictures already taken) inside Vercel's
300-second limit.
Every field that reaches the image model (scenes, looks, age, title,
direction) is signed by /api/generate-book (`ORDER_CONFIRM_SECRET`), so the
art routes only illustrate stories we wrote.

Without `GEMINI_API_KEY`, or on any Gemini failure or safety refusal, the
endpoints return null URLs: the stock typographic cover stays put, and
Checkout keeps the order button locked and offers a retry. Each failed attempt
is logged as `[art] ...` with the model, HTTP status and Google's message.
`GEMINI_API_KEY` is required for art; Vercel deploys also need
`BLOB_READ_WRITE_TOKEN` (locally: `uploads/generated/`). Only pictures on your
own Blob store, under `farsh-art/`, are accepted as ours: the host is taken
from `BLOB_PUBLIC_HOST`, or derived from the token when that is unset.

## Project layout

```
server.js              Express server: static files + the story/art API routes + rate limiting
lib/generateBook.js     Builds the prompt, calls Claude, returns eleven page texts
lib/generateArt.js      Gemini image pipeline: photo -> cover -> plates, three at a time
lib/artPrompts.js       Photorealistic, identity-preserving prompt builders
lib/pageCount.js        The number of story pages
lib/scenesToken.js      Signs the scene lines between writer and illustrator
lib/rateLimit.js        Per-IP + global rate limiting for the generation endpoints
lib/stripExif.js        Strips EXIF metadata from an uploaded photo before it's sent to Gemini
api/                    Vercel serverless functions — one per route, mirroring server.js
test/                   node --test unit tests for everything in lib/
Landing Page.dc.html    )
Book Builder.dc.html    ) the site itself — unchanged except Book Preview.dc.html,
Book Preview.dc.html    ) which now calls /api/generate-book on load
Checkout.dc.html        )
support.js              dc-runtime — the templating engine these pages use
_ds/                    Design system (Modernist) — fonts, colors, base styles
uploads/                Sample cover & page photography, plus generated art when saved locally
docs/                   Design notes for this generation work
```

See `docs/2026-08-16-ai-book-generation-design.md` for the reasoning behind
what's wired up vs. simulated (payments) and what deploying the image
pipeline needs (`GEMINI_API_KEY`, `BLOB_READ_WRITE_TOKEN` on Vercel).

## Troubleshooting

- **Book Preview shows the sample "Amara" story instead of a real one** —
  either no key is set, the key is invalid, or the request failed. Check the
  terminal running `npm start` for the error, and the small note under the
  chapter text on the page itself.
- **Port 4000 already in use** — set `PORT=...` in `.env` to something else.
