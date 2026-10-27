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
const { isAllowedAudience } = require('./lib/audiences');
const { signScenes, tokenFieldsFor, adoptSignedStory } = require('./lib/scenesToken');
const { PAGE_COUNT } = require('./lib/pageCount');
const { placeOrder } = require('./lib/placeOrder');
const { verify: verifyOrderToken } = require('./lib/orderToken');
const { sendPaymentDecision } = require('./lib/confirmPayment');
const { renderReviewPage, renderResultPage, renderErrorPage } = require('./lib/orderConfirmPage');
const { SECURITY_HEADERS, isHiddenPath } = require('./lib/siteHeaders');

const app = express();
const PORT = process.env.PORT || 4000;

// Behind a reverse proxy / hosting platform, use the forwarded client IP
// so rate limits apply per visitor rather than per proxy. Rate limiting does
// NOT go through req.ip — see lib/clientIp.js for why the forwarded chain has
// to be read from the right, and only when a proxy is actually in front.
app.set('trust proxy', 1);

// Browser security headers on everything, and a 404 for the parts of this
// directory that are code rather than site. vercel.json does the same for
// the deployed copy; lib/siteHeaders.js explains both.
app.use((req, res, next) => {
  res.set(SECURITY_HEADERS);
  if (isHiddenPath(req.path)) return res.status(404).type('text').send('Not found');
  next();
});

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

// Every art route draws the child's face into a story, so every one of them
// needs the token /api/generate-book signed (see lib/scenesToken.js): the
// scenes, looks, age, title and direction the image model sees are the
// signed ones, never the client's own text. The face itself goes to Google,
// so the parent's consent is checked here too, not only at order time.
//
// `weight` is how many images the route may spend (see lib/rateLimit.js).
// The api/*.js twins carry the same checks inline.
function artRoute(handler, { weight = 1 } = {}) {
  return async (req, res) => {
    const limited = checkRateLimit(clientIp(req), 'art', weight);
    if (limited) {
      res.set('Retry-After', String(limited.retryAfterSeconds));
      return res.status(limited.status).json({ error: limited.error, message: limited.message });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const book = body.book && typeof body.book === 'object' ? body.book : body;
    if (!isAllowedAudience(book.audience)) {
      return res.status(400).json({ error: 'unsupported_audience', message: 'We only make children\'s books right now.' });
    }
    if (book.photoConsent !== true) {
      return res.status(400).json({ error: 'consent_required', message: 'Please confirm the photo consent first.' });
    }
    try {
      adoptSignedStory(book, body.scenesToken);
    } catch (err) {
      console.error('[art] story refused:', err.message);
      if (err.code === 'not_configured') console.error('  -> set ORDER_CONFIRM_SECRET in .env; nothing can be illustrated without it.');
      return res.status(400).json({ error: 'invalid_scenes', message: 'Please write the story again before illustrating it.' });
    }
    try {
      res.json(await handler(book, body));
    } catch (err) {
      console.error('[art] failed:', err.message);
      res.status(502).json({ error: 'art_failed', message: 'Could not paint right now.' });
    }
  };
}

// An order carries the whole book, photo included, so it needs the bigger body
// limit — registered here with the other 8mb routes for the same reason.
app.post('/api/place-order', artJson, async (req, res) => {
  const limited = checkRateLimit(clientIp(req), 'order');
  if (limited) {
    res.set('Retry-After', String(limited.retryAfterSeconds));
    return res.status(limited.status).json({ error: limited.error, message: limited.message });
  }
  try {
    const { orderNumber } = await placeOrder(req.body && typeof req.body === 'object' ? req.body : {});
    res.json({ orderNumber });
  } catch (err) {
    if (err.code === 'invalid_order') {
      console.error('[place-order] rejected:', err.problems.join(' '));
      return res.status(400).json({ error: 'invalid_order', message: 'That order is missing something we need.' });
    }
    console.error('[place-order] FAILED — no order was recorded:', err.message);
    if (/not_configured/.test(err.message)) {
      console.error('  -> set RESEND_API_KEY and ORDER_EMAIL_TO in .env, or orders go nowhere.');
    }
    res.status(502).json({
      error: 'order_failed',
      message: 'We could not place that order just now. Nothing has been charged or started — please try again.',
    });
  }
});

app.post('/api/generate-cover', artJson, artRoute((book) => generateCoverArt(book)));
app.post('/api/generate-plates', artJson, artRoute((book) => generatePlates(book), { weight: PAGE_COUNT }));
app.post('/api/redraw-page', artJson, artRoute((book, body) => redrawPlate(book, body.pageIndex)));

// Everything else — in particular /api/generate-book — gets the smaller,
// app-wide body limit. The client strips art fields (photo, photoConsent,
// coverUrl, plateUrls) out of the book before posting
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
  if (!isAllowedAudience(book.audience)) {
    return res.status(400).json({ error: 'unsupported_audience', message: 'We only make children\'s books right now.' });
  }

  try {
    // Explicit .env key preferred; otherwise the SDK's own credential
    // resolution (auth token / `ant auth login` profile) gets a chance.
    const { pages, scenes } = await generateBookPages(book, process.env.ANTHROPIC_API_KEY);
    let scenesToken = null;
    try {
      // Signed as clamped, so the token holds exactly what the prompt sees.
      scenesToken = signScenes(tokenFieldsFor(book, scenes));
    } catch (err) {
      // The story still works without it; only illustrating does not.
      console.error('[generate-book] could not sign the story:', err.message);
      if (err.code === 'not_configured') console.error('  -> set ORDER_CONFIRM_SECRET in .env, or nothing can be illustrated.');
    }
    res.json({ pages, scenes, scenesToken });
  } catch (err) {
    // Two audiences, two texts. `message` is read straight into the page a
    // customer is looking at, so it never carries setup instructions or
    // internals; the operator-facing version goes to the log, which is where
    // the README already tells you to look.
    console.error('[generate-book] failed:', err.message);
    const missingKey = err.message === 'missing_api_key' || /Could not resolve authentication/.test(err.message);
    if (missingKey || err.status === 401) {
      console.error(
        missingKey
          ? '  -> no ANTHROPIC_API_KEY. Copy .env.example to .env, add your key, and restart the server.'
          : '  -> ANTHROPIC_API_KEY was rejected (401). The key is set but invalid, revoked or out of credit.',
      );
      return res.status(400).json({
        error: 'missing_api_key',
        message: 'Our writer is not available right now.',
      });
    }
    const status = /^generation_refused/.test(err.message) ? 422 : 502;
    res.status(status).json({
      error: 'generation_failed',
      message: 'We could not write the book just now.',
    });
  }
});

// The order email's "Review & confirm" link. GET only renders (no side
// effects, so an email client or security scanner prefetching the link
// can't confirm/reject anything by itself); the actual decision happens on
// POST, from a click on one of the two buttons that page renders. Its own
// small urlencoded parser — scoped to this route only, not app-wide — so it
// has no bearing on the JSON body-limit ordering documented above.
const orderConfirmForm = express.urlencoded({ extended: false, limit: '8kb' });

app.get('/api/order-confirm', (req, res) => {
  try {
    const summary = verifyOrderToken(req.query.token);
    res.set('Content-Type', 'text/html').send(renderReviewPage(summary, req.query.token));
  } catch (err) {
    console.error('[order-confirm] view rejected:', err.message);
    res.status(400).set('Content-Type', 'text/html').send(renderErrorPage('This link is invalid or no longer usable.'));
  }
});

app.post('/api/order-confirm', orderConfirmForm, async (req, res) => {
  const { token, action } = req.body || {};
  try {
    const result = await sendPaymentDecision(token, action);
    res.set('Content-Type', 'text/html').send(renderResultPage(result));
  } catch (err) {
    console.error('[order-confirm] action failed:', err.message);
    if (err.code === 'not_configured') console.error('  -> set ORDER_CONFIRM_SECRET in .env.');
    const status = err.code === 'invalid_action' || err.code === 'invalid_token' ? 400 : 502;
    const message = err.code === 'invalid_token'
      ? 'This link is invalid or no longer usable.'
      : err.code === 'invalid_action'
        ? 'Unknown action.'
        : 'Could not email the customer just now — try again in a moment.';
    res.status(status).set('Content-Type', 'text/html').send(renderErrorPage(message));
  }
});

// Static files last, so /api/* above always wins over any same-named file.
app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

// Listen only when run directly (`npm start`), so a test can require this
// file for artRoute without opening a port.
if (require.main === module) app.listen(PORT, () => {
  console.log(`farsh! running at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('  (no ANTHROPIC_API_KEY set — book generation will fall back to sample text)');
  }
  if (!process.env.RESEND_API_KEY || !process.env.ORDER_EMAIL_TO) {
    console.log('  (no RESEND_API_KEY / ORDER_EMAIL_TO — placing an order will FAIL loudly rather than lose it)');
  }
});

module.exports = { app, artRoute };
