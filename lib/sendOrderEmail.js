// Turns a placed order into an email, and sends it via Resend.
//
// This email IS the order record. There is no database: if the send fails the
// order does not exist anywhere, so the caller must surface that to the
// customer rather than telling them their book is being made. Every failure
// path here throws for exactly that reason — nothing is swallowed.
//
// Resend is called over its REST API rather than through its SDK, matching how
// lib/generateArt.js talks to Gemini: one less dependency, and the failure
// modes stay visible.

const { sendEmail } = require('./resendTransport');
const { sign } = require('./orderToken');

// Without a verified domain, Resend only allows its shared onboarding sender,
// and only to the account holder's own address. That is precisely this case —
// orders going to the owner — so it is the default rather than a workaround.
const DEFAULT_FROM = 'Farsh! orders <onboarding@resend.dev>';

const AUDIENCE_LABEL = { child: "A child's book", couple: "A couple's book", family: "A family book" };

/** FA-#### — short enough to read down a phone, unique enough for a day's orders. */
function orderNumber(rand = Math.random) {
  return 'FA-' + String(Math.floor(1000 + rand() * 8999));
}

function line(label, value) {
  const v = value === 0 ? '0' : value;
  return v ? `${label}: ${v}` : null;
}

// VERCEL_URL has no protocol and is set by the platform itself; APP_BASE_URL
// is the escape hatch for a custom domain or local testing.
function baseUrl(deps) {
  if (deps.baseUrl) return deps.baseUrl.replace(/\/$/, '');
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT || 4000}`;
}

/**
 * The order as plain text. Kept plain deliberately — it has to be readable on a
 * phone, forwardable to a binder, and never mangled by an HTML mail client.
 * Pure (no network I/O) and snapshot-testable, EXCEPT that an order carrying
 * a payment screenshot signs a confirm/reject link via orderToken.sign, which
 * throws rather than silently omitting the link if ORDER_CONFIRM_SECRET is
 * not configured — an order you can never confirm payment on is worse than
 * one that fails loudly at compose time.
 *
 * @param {object} order
 * @param {object} [deps] - { secret, baseUrl } for orderToken.sign / tests
 */
function composeOrderEmail(order, deps = {}) {
  const b = (order && order.book) || {};
  const s = (order && order.ship) || {};
  const data = (b.data && typeof b.data === 'object') ? b.data : {};

  const details = Object.entries(data)
    .map(([k, v]) => line('  ' + k, String(v || '').trim()))
    .filter(Boolean);

  const body = [
    `Order ${order.orderNumber}`,
    `Placed ${order.placedAt}`,
    '',
    'THE BOOK',
    line('  For', AUDIENCE_LABEL[b.audience] || b.audience),
    line('  Title', b.title),
    line('  Name(s)', b.names),
    line('  Direction', b.directionName || (b.direction === 0 || b.direction ? `#${b.direction}` : null)),
    details.length ? '  --' : null,
    ...details,
    line('  Woven in', Array.isArray(b.tags) && b.tags.length ? b.tags.join(', ') : null),
    line('  Dedication', b.dedication),
    line('  Photo supplied', b.photo ? `yes (consent ${b.photoConsent ? 'given' : 'NOT given'})` : 'no'),
    '',
    'THE ORDER',
    line('  Edition', order.format),
    line('  Delivery', order.speed),
    line('  Gift wrap', order.gift ? 'yes' : 'no'),
    line('  Total', order.total),
    '',
    'SEND IT TO',
    line('  Name', s.who),
    line('  Email', s.email),
    line('  Address', s.address),
    line('  Note on the card', s.note),
    ...(order.paymentScreenshotUrl ? [
      '',
      'PAYMENT',
      line('  Screenshot', order.paymentScreenshotUrl),
      line('  Review & confirm', `${baseUrl(deps)}/api/order-confirm?token=${encodeURIComponent(sign({
        orderNumber: order.orderNumber, email: s.email, names: b.names, total: order.total,
      }, deps))}`),
    ] : []),
  ].filter((l) => l !== null).join('\n');

  return {
    subject: `Farsh! order ${order.orderNumber} — ${b.names || 'a book'} (${b.title || 'untitled'})`,
    text: body,
  };
}

/**
 * @param {object} order
 * @param {object} [deps] - { apiKey, to, from, fetchFn } for tests
 * @returns {Promise<{orderNumber: string, id: string}>}
 * @throws when unconfigured, when Resend rejects, or when the network fails —
 *   the caller must not report success unless this resolves.
 */
async function sendOrderEmail(order, deps = {}) {
  const to = deps.to || process.env.ORDER_EMAIL_TO;
  const from = deps.from || process.env.ORDER_EMAIL_FROM || DEFAULT_FROM;

  if (!(deps.apiKey || process.env.RESEND_API_KEY)) throw new Error('email_not_configured');
  if (!to) throw new Error('email_recipient_not_configured');

  const { subject, text } = composeOrderEmail(order, deps);
  const { id } = await sendEmail(
    { to: [to], from, subject, text, replyTo: (order.ship || {}).email || undefined },
    deps,
  );
  return { orderNumber: order.orderNumber, id };
}

module.exports = { sendOrderEmail, composeOrderEmail, orderNumber, DEFAULT_FROM };
