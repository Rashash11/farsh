// Vercel serverless twin of the /api/place-order route in server.js.
// Same contract, same rate limiting, same refusal to claim success unless the
// order email actually went out.

const { placeOrder } = require('../lib/placeOrder');
const { checkRateLimit } = require('../lib/rateLimit');
const { clientIp } = require('../lib/clientIp');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed', message: 'POST only.' });
    return;
  }
  const limited = checkRateLimit(clientIp(req), 'order');
  if (limited) {
    res.setHeader('Retry-After', String(limited.retryAfterSeconds));
    res.status(limited.status).json({ error: limited.error, message: limited.message });
    return;
  }

  try {
    const { orderNumber } = await placeOrder(req.body && typeof req.body === 'object' ? req.body : {});
    res.status(200).json({ orderNumber });
  } catch (err) {
    if (err.code === 'invalid_order') {
      console.error('[place-order] rejected:', err.problems.join(' '));
      res.status(400).json({ error: 'invalid_order', message: 'That order is missing something we need.' });
      return;
    }
    // The customer must never be told the book is being made when it is not.
    console.error('[place-order] FAILED — no order was recorded:', err.message);
    if (/not_configured/.test(err.message)) {
      console.error('  -> set RESEND_API_KEY and ORDER_EMAIL_TO on this deployment, or orders go nowhere.');
    }
    res.status(502).json({
      error: 'order_failed',
      message: 'We could not place that order just now. Nothing has been charged or started — please try again.',
    });
  }
};
