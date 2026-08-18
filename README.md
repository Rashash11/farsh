# Farsh! — personalized book platform

A platform for creating personalized hardcover books: children's adventure
books and couples' love-story books.

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
  the builder (name, age, what they look like, what they love / how the
  couple met / etc.), via `POST /api/generate-book`.
- **"Place the order" on Checkout is a UI simulation**, same as before this
  work — it shows a confirmation and a fake order number, but doesn't charge
  a card or send anything anywhere. No payment processing is wired up.
- **Cover and page art** is real too, when `GEMINI_API_KEY` is set — see
  "Illustrations" below. Without a key, covers and pages show the original
  typographic art, same silent fallback as story generation.

## Illustrations

Three endpoints paint the art: `POST /api/generate-cover`,
`POST /api/generate-plates` (after Checkout), and `POST /api/redraw-page`.
A builder photo drives the art when present, falling back to the
character's text description if that pass fails (safety refusal, network
error) — Preview shows a small note when it does. Without `GEMINI_API_KEY`,
or on any Gemini failure, all three return null URLs and the stock
typographic art stays put. `GEMINI_API_KEY` is required for art; Vercel
deploys also need `BLOB_READ_WRITE_TOKEN` (locally: `uploads/generated/`).

## Project layout

```
server.js              Express server: static files + the story/art API routes + rate limiting
lib/generateBook.js     Builds the prompt, calls Claude, returns 6 page texts
lib/generateArt.js      Gemini image pipeline: character sheet -> cover -> plates
lib/artPrompts.js       Pure, snapshot-testable prompt builders for the illustrations
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
