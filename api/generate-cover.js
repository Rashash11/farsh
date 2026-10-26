// Vercel serverless twin of /api/generate-cover in server.js.
const { generateCoverArt } = require('../lib/generateArt');
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
  const book = body.book || body;
  if (!isAllowedAudience(book.audience)) {
    res.status(400).json({ error: 'unsupported_audience', message: 'We only make children\'s books right now.' });
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
// Eleven Gemini calls at concurrency 3 with a 60s abort each can legitimately
// run a couple of minutes; without this Vercel would cut the function off at
// its default and the customer would see a silent "no plates".
module.exports.config = { maxDuration: 300 };
