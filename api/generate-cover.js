// Vercel serverless twin of /api/generate-cover in server.js.
const { generateCoverArt } = require('../lib/generateArt');
const { checkRateLimit } = require('../lib/rateLimit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed', message: 'POST only.' });
    return;
  }
  const fwd = req.headers['x-forwarded-for'];
  const ip = (typeof fwd === 'string' && fwd.split(',')[0].trim()) ||
    (req.socket && req.socket.remoteAddress) || 'unknown';
  const limited = checkRateLimit(ip, 'art');
  if (limited) {
    res.setHeader('Retry-After', String(limited.retryAfterSeconds));
    res.status(limited.status).json({ error: limited.error, message: limited.message });
    return;
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const book = body.book || body;
  if (!book.audience) {
    res.status(400).json({ error: 'missing_audience', message: 'Request body must include "book.audience".' });
    return;
  }
  try {
    res.status(200).json(await generateCoverArt(book));
  } catch (err) {
    console.error('[generate-cover] failed:', err.message);
    res.status(502).json({ error: 'art_failed', message: 'Could not paint right now.' });
  }
};
