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
    console.error('[generate-book] failed:', err.message);
    if (err.message === 'missing_api_key' || err.status === 401 || /Could not resolve authentication/.test(err.message)) {
      res.status(400).json({
        error: 'missing_api_key',
        message: 'No ANTHROPIC_API_KEY configured on the server yet.',
      });
      return;
    }
    const status = /^generation_refused/.test(err.message) ? 422 : 502;
    res.status(status).json({
      error: 'generation_failed',
      message: 'Could not write the book right now. Showing a sample page instead.',
    });
  }
};
