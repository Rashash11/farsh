// Turns a click on the order email's Confirm/Reject link into a customer
// notification. The token (see lib/orderToken.js) is the only authorization —
// there is no order lookup, so a tampered or expired token must fail closed
// before any email goes out.

const { verify } = require('./orderToken');
const { sendEmail } = require('./resendTransport');
const { DEFAULT_FROM } = require('./sendOrderEmail');

function composeConfirmedEmail(order) {
  const greeting = order.names ? `Hi ${order.names},` : 'Hi,';
  return {
    subject: `Farsh! order ${order.orderNumber} — payment confirmed`,
    text: `${greeting}\n\nYour payment for order ${order.orderNumber} is confirmed — we're making your book now.\n\nThanks for ordering from Farsh!`,
  };
}

function composeRejectedEmail(order) {
  const greeting = order.names ? `Hi ${order.names},` : 'Hi,';
  return {
    subject: `Farsh! order ${order.orderNumber} — we couldn't confirm your payment`,
    text: `${greeting}\n\nWe couldn't verify the payment for order ${order.orderNumber}. Please reply to this email or resend your payment screenshot so we can get your book moving.\n\nFarsh!`,
  };
}

const COMPOSERS = { confirm: composeConfirmedEmail, reject: composeRejectedEmail };

/**
 * @param {string} token - from the order email's Confirm/Reject link
 * @param {'confirm'|'reject'} action
 * @param {object} [deps] - { secret, apiKey, from, fetchFn } for tests
 * @returns {Promise<{orderNumber: string, action: string}>}
 * @throws Error with .code 'invalid_action' (unknown action), 'not_configured'
 *   or 'invalid_token' (from orderToken.verify), or an email send failure —
 *   none of these send anything to the customer.
 */
async function sendPaymentDecision(token, action, deps = {}) {
  const compose = COMPOSERS[action];
  if (!compose) {
    const err = new Error('unknown_payment_action: ' + action);
    err.code = 'invalid_action';
    throw err;
  }

  const order = verify(token, deps);
  const from = deps.from || process.env.ORDER_EMAIL_FROM || DEFAULT_FROM;
  const { subject, text } = compose(order);

  await sendEmail({ to: [order.email], from, subject, text }, deps);
  return { orderNumber: order.orderNumber, action };
}

module.exports = { composeConfirmedEmail, composeRejectedEmail, sendPaymentDecision };
