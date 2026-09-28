// Farsh! local server.
//
//   1. Serves this whole directory as static files — the site works exactly
//      as it did before (same .dc.html pages, same assets, same paths).
//   2. Adds one API endpoint, POST /api/generate-book, that writes real
//      story text for a book using the Claude API. Everything else is
//      unchanged.
//
// Run: npm install && npm start   (copy .env.example to .env first and add
// your ANTHROPIC_API_KEY, or requests to /api/generate-book will 400 with a
// clear message — the site itself still loads fine without a key.)

require('dotenv').config();
const path = require('path');
const express = require('express');
const { generateBookPages } = require('./lib/generateBook');
const { generateCoverArt, generatePlates, redrawPlate } = require('./lib/generateArt');
const { checkRateLimit } = require('./lib/rateLimit');
const { clientIp } = require('./lib/clientIp');

const app = express();
const PORT = process.env.PORT || 4000;

// Behind a reverse proxy / hosting platform, use the forwarded client IP
// so rate limits apply per visitor rather than per proxy. Rate limiting does
// NOT go through req.ip — see lib/clientIp.js for why the forwarded chain has
// to be read from the right, and only when a proxy is actually in front.
app.set('trust proxy', 1);

app.get('/', (req, res) => res.redirect('/Landing Page.dc.html'));

// Photos ride along as base64 — allow a bigger body on art routes only.
//
// ORDERING REQUIREMENT — do not move this below the app-wide
// express.json({ limit: '256kb' }) further down, and do not merge the two
// parsers. Express walks middleware/routes in registration order; these
// three routes (and their own 8mb `artJson` parser) are registered BEFORE
// the app-wide 256kb parser specifically so that parser never runs for
// them — each art route sends its response and the request never reaches
// it. If the 256kb parser ran first instead (as it briefly did), it would
// reject every real photo upload (~100-400KB base64) with an ungraceful
// 413 before the art route's own 8mb limit, rate check, or audience check
// ever got a chance to run. /api/generate-book (no photos, small JSON
// payloads) is what the smaller app-wide limit below is meant to protect.
const artJson = express.json({ limit: '8mb' });

function artRoute(handler) {
  return async (req, res) => {
    const limited = checkRateLimit(clientIp(req), 'art');
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

// Everything else — in particular /api/generate-book — gets the smaller,
// app-wide body limit. The client strips art fields (photo, photoConsent,
// characterSheetUrl, coverUrl, plateUrls) out of the book before posting
// to this route, so it never carries photo data. Registered AFTER the art
// routes above so it never runs for their requests (see ordering comment).
app.use(express.json({ limit: '256kb' }));

app.post('/api/generate-book', async (req, res) => {
  const limited = checkRateLimit(clientIp(req));
  if (limited) {
    res.set('Retry-After', String(limited.retryAfterSeconds));
    return res.status(limited.status).json({ error: limited.error, message: limited.message });
  }

  const book = req.body && typeof req.body === 'object' ? req.body : {};
  if (!book.audience) {
    return res.status(400).json({ error: 'missing_audience', message: 'Request body must include "audience".' });
  }

  try {
    // Explicit .env key preferred; otherwise the SDK's own credential
    // resolution (auth token / `ant auth login` profile) gets a chance.
    const { pages, scenes } = await generateBookPages(book, process.env.ANTHROPIC_API_KEY);
    res.json({ pages, scenes });
  } catch (err) {
    console.error('[generate-book] failed:', err.message);
    if (err.message === 'missing_api_key' || err.status === 401 || /Could not resolve authentication/.test(err.message)) {
      return res.status(400).json({
        error: 'missing_api_key',
        message: 'No ANTHROPIC_API_KEY configured. Copy .env.example to .env, add your key, and restart the server.',
      });
    }
    const status = /^generation_refused/.test(err.message) ? 422 : 502;
    res.status(status).json({
      error: 'generation_failed',
      message: 'Could not write the book right now. Showing a sample page instead.',
      detail: err.message,
    });
  }
});

// Static files last, so /api/* above always wins over any same-named file.
app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`farsh! running at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('  (no ANTHROPIC_API_KEY set — book generation will fall back to sample text)');
  }
});
