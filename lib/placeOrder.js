// Server side of placing an order, shared by server.js and api/place-order.js.
//
// Everything the browser checks is checked again here. The client guards exist
// to be helpful; these exist to be true. A request that skips the UI entirely
// must not be able to book a nameless book to nowhere.

const { sendOrderEmail, orderNumber } = require('./sendOrderEmail');

const AUDIENCES = ['child', 'couple', 'family'];
// Mirrors requiredFields() in Book Builder.dc.html — the names printed on the cover.
const REQUIRED_BOOK_FIELDS = { child: ['name'], couple: ['name', 'partner'], family: ['name'] };
const PLACEHOLDER_NAMES = ['your kid', 'the two of you', 'your family', 'them', 'you'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** @returns {string[]} human-readable problems; empty means the order is sound. */
function validateOrder(payload) {
  const problems = [];
  const book = (payload && payload.book) || null;
  const ship = (payload && payload.ship) || {};

  if (!book || typeof book !== 'object') {
    problems.push('No book was included.');
    return problems;
  }
  if (AUDIENCES.indexOf(book.audience) === -1) problems.push('Unknown audience.');

  const data = (book.data && typeof book.data === 'object') ? book.data : {};
  for (const k of REQUIRED_BOOK_FIELDS[book.audience] || ['name']) {
    if (!str(data[k])) problems.push(`The book is missing "${k}".`);
  }
  // Catches a book that kept its placeholder subject even though data looks set.
  const names = str(book.names);
  if (!names || PLACEHOLDER_NAMES.indexOf(names.toLowerCase()) > -1) {
    problems.push('The book has not been personalised.');
  }

  if (!str(ship.who)) problems.push('No recipient name.');
  if (!EMAIL_RE.test(str(ship.email))) problems.push('No valid email address.');
  if (!str(ship.address)) problems.push('No delivery address.');

  return problems;
}

/**
 * Validates, then sends. The email is the only record of the order, so this
 * resolves ONLY if the email actually went out.
 *
 * @returns {Promise<{orderNumber: string}>}
 * @throws Error with .code 'invalid_order' (and .problems) or the underlying
 *   send failure.
 */
async function placeOrder(payload, deps = {}) {
  const problems = validateOrder(payload);
  if (problems.length) {
    const err = new Error('invalid_order');
    err.code = 'invalid_order';
    err.problems = problems;
    throw err;
  }

  const order = {
    orderNumber: (deps.orderNumber || orderNumber)(),
    placedAt: (deps.now || (() => new Date()))().toISOString(),
    book: payload.book,
    ship: payload.ship,
    format: str(payload.format),
    speed: str(payload.speed),
    gift: !!payload.gift,
    total: str(payload.total),
  };

  await (deps.send || sendOrderEmail)(order, deps.sendDeps);
  return { orderNumber: order.orderNumber };
}

module.exports = { placeOrder, validateOrder, REQUIRED_BOOK_FIELDS, PLACEHOLDER_NAMES };
