// Vercel serverless twin of /api/generate-plates in server.js.
const { generatePlates } = require('../lib/generateArt');
const { verifyScenes } = require('../lib/scenesToken');
const { checkRateLimit } = require('../lib/rateLimit');
const { clientIp } = require('../lib/clientIp');
const { isAllowedAudience } = require('../lib/audiences');

module.exports = async (req, res) => {
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
  const book = body.book || body;
  if (!isAllowedAudience(book.audience)) {
    res.status(400).json({ error: 'unsupported_audience', message: 'We only make children\'s books right now.' });
    return;
  }
  try {
    book.scenes = verifyScenes(body.scenesToken);
  } catch (err) {
    console.error('[art] scenes refused:', err.message);
    if (err.code === 'not_configured') console.error('  -> set ORDER_CONFIRM_SECRET on this deployment; plates cannot be illustrated without it.');
    res.status(400).json({ error: 'invalid_scenes', message: 'Please write the story again before illustrating it.' });
    return;
  }
  try {
    res.status(200).json(await generatePlates(book));
  } catch (err) {
    console.error('[generate-plates] failed:', err.message);
    res.status(502).json({ error: 'art_failed', message: 'Could not paint right now.' });
  }
};
