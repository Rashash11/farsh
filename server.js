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
const { checkRateLimit } = require('./lib/rateLimit');

const app = express();
const PORT = process.env.PORT || 4000;

// Behind a reverse proxy / hosting platform, use the forwarded client IP
// so rate limits apply per visitor rather than per proxy.
app.set('trust proxy', 1);

app.use(express.json({ limit: '256kb' }));

app.get('/', (req, res) => res.redirect('/Landing Page.dc.html'));

app.post('/api/generate-book', async (req, res) => {
  const limited = checkRateLimit(req.ip || 'unknown');
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
    const pages = await generateBookPages(book, process.env.ANTHROPIC_API_KEY);
    res.json({ pages });
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
