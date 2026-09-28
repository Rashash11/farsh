// Vercel serverless twin of the /api/generate-book route in server.js.
// Same contract, same rate limiting, same graceful failures — the frontend
// can't tell which one it's talking to. server.js remains the local dev path.

const { generateBookPages } = require('../lib/generateBook');
const { checkRateLimit } = require('../lib/rateLimit');
const { clientIp } = require('../lib/clientIp');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed', message: 'POST only.' });
    return;
  }

  const ip = clientIp(req);
  const limited = checkRateLimit(ip);
  if (limited) {
    res.setHeader('Retry-After', String(limited.retryAfterSeconds));
    res.status(limited.status).json({ error: limited.error, message: limited.message });
    return;
  }

  const book = req.body && typeof req.body === 'object' ? req.body : {};
  if (!book.audience) {
    res.status(400).json({ error: 'missing_audience', message: 'Request body must include "audience".' });
    return;
  }

  try {
    const { pages, scenes } = await generateBookPages(book, process.env.ANTHROPIC_API_KEY);
    res.status(200).json({ pages, scenes });
  } catch (err) {
    // See the note in server.js: `message` is customer-facing, the detail
    // below is for whoever is reading the function logs.
    console.error('[generate-book] failed:', err.message);
    const missingKey = err.message === 'missing_api_key' || /Could not resolve authentication/.test(err.message);
    if (missingKey || err.status === 401) {
      console.error(
        missingKey
          ? '  -> ANTHROPIC_API_KEY is not set on this deployment.'
          : '  -> ANTHROPIC_API_KEY was rejected (401): set but invalid, revoked or out of credit.',
      );
      res.status(400).json({
        error: 'missing_api_key',
        message: 'Our writer is not available right now.',
      });
      return;
    }
    const status = /^generation_refused/.test(err.message) ? 422 : 502;
    res.status(status).json({
      error: 'generation_failed',
      message: 'We could not write the book just now.',
    });
  }
};
