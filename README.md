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
- **Covers and page photos** are the existing typographic covers /
  photo-upload placeholders — no AI image generation.

## Project layout

```
server.js              Express server: static files + POST /api/generate-book
lib/generateBook.js     Builds the prompt, calls Claude, returns 6 page texts
Landing Page.dc.html    )
Book Builder.dc.html    ) the site itself — unchanged except Book Preview.dc.html,
Book Preview.dc.html    ) which now calls /api/generate-book on load
Checkout.dc.html        )
support.js              dc-runtime — the templating engine these pages use
_ds/                    Design system (Modernist) — fonts, colors, base styles
uploads/                Sample cover & page photography
docs/                   Design notes for this generation work
```

See `docs/2026-08-16-ai-book-generation-design.md` for the reasoning behind
what's wired up vs. deliberately left alone (payments, images, deployment).

## Troubleshooting

- **Book Preview shows the sample "Amara" story instead of a real one** —
  either no key is set, the key is invalid, or the request failed. Check the
  terminal running `npm start` for the error, and the small note under the
  chapter text on the page itself.
- **Port 4000 already in use** — set `PORT=...` in `.env` to something else.
