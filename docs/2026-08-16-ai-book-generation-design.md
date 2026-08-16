# AI book generation — design notes

**Status:** built autonomously while the user was away, per their instruction
("work until it's full and ready to just put the api key in and generate
books"). Documenting the decisions here since there was no live sign-off loop
— review and flag anything you want changed.

## What "full and ready" means here

Today the Book Builder → Book Preview → Checkout flow is a polished frontend
prototype. Book Preview's story pages are hardcoded Mad-Libs-style templates
(name substituted into six fixed paragraphs) — not actually written for the
book's audience/details. This work replaces that with a real AI-written story,
generated from what the user typed into Book Builder, while leaving everything
else about the product (design, animations, checkout UI) untouched.

"Ready to just add an API key" = drop `ANTHROPIC_API_KEY` into a `.env` file,
`npm install && npm start`, and the app generates real per-page story text.

## Scope decisions (made without live approval — flagging for review)

**In scope:**
- A minimal Node/Express server that (a) serves the existing static site
  exactly as-is and (b) exposes `POST /api/generate-book`.
- Real story-text generation via the Claude API (`claude-opus-5`, structured
  JSON output), using the audience, names, and free-text details the user
  already enters in Book Builder.
- Wiring `Book Preview.dc.html` to call that endpoint and render the real
  story, with a clean fallback to the existing placeholder text if generation
  fails or no key is configured — the app never breaks, it degrades.

**Out of scope — left as-is on purpose:**
- **No real payment processing.** "Place the order" already just simulates
  success client-side (sets a local `placed` flag + a fake order number) —
  that's how it was before this work, and it stays that way. Wiring a real
  payment provider needs explicit sign-off and business/legal setup I'm not
  going to add unilaterally.
- **No AI-generated cover art or illustrations.** The existing designs use
  typographic covers and user-photo-upload slots, not AI images. Adding image
  generation means a second API/key nobody asked for. "The api key" (singular)
  strongly implied one key, for the story text.
- **No database, accounts, or server-side sessions.** Book Builder already
  persists the in-progress book to `localStorage` (`farsh.book`) and Book
  Preview already reads it — that plumbing pre-dates this work. I extended the
  same object with a `pages` field instead of introducing new infrastructure.
- **No deployment.** Runs locally via `npm start`. Nothing was pushed to the
  `Rashash11/farsh` GitHub repo referenced in `github.md` — no push access was
  set up, and pushing is an outward-facing action that needs a explicit go-ahead.

## Architecture

```
Book Builder.dc.html  (unchanged)
  → saves audience/names/details/tags/dedication/title to localStorage
    key "farsh.book" (this already existed)
  → links to Book Preview.dc.html

Book Preview.dc.html  (edited)
  → on mount, reads "farsh.book"
  → if book.pages is missing/stale for the current inputs, POSTs the book
    to /api/generate-book and shows a "Writing your book…" state
  → merges the real generated pages into "farsh.book" pages field and
    displays them instead of the hardcoded placeholder story
  → on any failure (no key, network, bad response): falls back to the
    original placeholder story, with a small non-blocking notice

server.js (new)
  → serves the existing static files unchanged
  → POST /api/generate-book: reads ANTHROPIC_API_KEY from env, calls
    Claude with a structured-output schema matching the {chapter, text}[]
    shape Book Preview already expects, returns JSON
  → missing key → 400 with a clear message, not a crash
```

## Why this shape (vs. alternatives considered)

- **Node/Express + minimal edits** over **rewriting the frontend in
  React/Next**: the existing pages are already polished, animated, and on
  brand. A rewrite would be a much bigger, riskier project than "add an API
  key and generate books" implies, and risks visual regressions across 5
  pages. Rejected.
- **Server-side generation** over **calling Claude directly from the
  browser**: a client-side API key is visible to anyone who opens dev tools —
  not something to ship even as a demo. Rejected outright, not just
  deprioritized.
- **`localStorage` for the generated pages** over **a real backend
  session/database**: matches the existing (pre-this-work) pattern exactly,
  avoids inventing auth/accounts nobody asked for, and is enough for a
  single-browser demo/MVP.
