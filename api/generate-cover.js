// Vercel serverless twin of /api/generate-cover in server.js.
const { generateCoverArt } = require('../lib/generateArt');
const { adoptSignedStory } = require('../lib/scenesToken');
const { checkRateLimit } = require('../lib/rateLimit');
const { clientIp } = require('../lib/clientIp');
const { isAllowedAudience } = require('../lib/audiences');

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed', message: 'POST only.' });
    return;
  }
  const ip = clientIp(req);
  const limited = checkRateLimit(ip, 'art');
  if (limited) {
    res.setHeader('Retry-After', String(limited.retryAfterSeconds));
    res.status(limited.status).json({ error: limited.error, message: limited.message });
    return;
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const book = body.book && typeof body.book === 'object' ? body.book : body;
  if (!isAllowedAudience(book.audience)) {
    res.status(400).json({ error: 'unsupported_audience', message: 'We only make children\'s books right now.' });
    return;
  }
  // Same checks as artRoute in server.js: the face goes to Google, so consent
  // first; then only a story /api/generate-book signed is ever illustrated,
  // with the signed fields overwriting whatever the client sent.
  if (book.photoConsent !== true) {
    res.status(400).json({ error: 'consent_required', message: 'Please confirm the photo consent first.' });
    return;
  }
  try {
    adoptSignedStory(book, body.scenesToken);
  } catch (err) {
    console.error('[art] story refused:', err.message);
    if (err.code === 'not_configured') console.error('  -> set ORDER_CONFIRM_SECRET on this deployment; nothing can be illustrated without it.');
    res.status(400).json({ error: 'invalid_scenes', message: 'Please write the story again before illustrating it.' });
    return;
  }
  try {
    res.status(200).json(await generateCoverArt(book));
  } catch (err) {
    console.error('[generate-cover] failed:', err.message);
    res.status(502).json({ error: 'art_failed', message: 'Could not paint right now.' });
  }
};

module.exports = handler;
// One Gemini call, but it shares the 300s budget with the plates route so a
// slow retry is not cut off.
module.exports.config = { maxDuration: 300 };
