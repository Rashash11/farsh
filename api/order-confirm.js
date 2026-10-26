// Vercel serverless twin of the /api/order-confirm routes in server.js.
// Same contract: GET only renders (no side effects — safe against email
// prefetchers), POST acts on a button click and emails the customer.

const { verify: verifyOrderToken } = require('../lib/orderToken');
const { sendPaymentDecision } = require('../lib/confirmPayment');
const { renderReviewPage, renderResultPage, renderErrorPage } = require('../lib/orderConfirmPage');

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    try {
      const token = (req.query && req.query.token) || '';
      const summary = verifyOrderToken(token);
      res.setHeader('Content-Type', 'text/html');
      res.status(200).send(renderReviewPage(summary, token));
    } catch (err) {
      console.error('[order-confirm] view rejected:', err.message);
      res.setHeader('Content-Type', 'text/html');
      res.status(400).send(renderErrorPage('This link is invalid or no longer usable.'));
    }
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed', message: 'GET or POST only.' });
    return;
  }

  const { token, action } = (req.body && typeof req.body === 'object') ? req.body : {};
  try {
    const result = await sendPaymentDecision(token, action);
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(renderResultPage(result));
  } catch (err) {
    console.error('[order-confirm] action failed:', err.message);
    if (err.code === 'not_configured') console.error('  -> set ORDER_CONFIRM_SECRET on this deployment.');
    const status = err.code === 'invalid_action' || err.code === 'invalid_token' ? 400 : 502;
    const message = err.code === 'invalid_token'
      ? 'This link is invalid or no longer usable.'
      : err.code === 'invalid_action'
        ? 'Unknown action.'
        : 'Could not email the customer just now — try again in a moment.';
    res.setHeader('Content-Type', 'text/html');
    res.status(status).send(renderErrorPage(message));
  }
};
