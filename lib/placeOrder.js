// Server side of placing an order, shared by server.js and api/place-order.js.
//
// Everything the browser checks is checked again here. The client guards exist
// to be helpful; these exist to be true. A request that skips the UI entirely
// must not be able to book a nameless book to nowhere.

const crypto = require('crypto');
const { sendOrderEmail, orderNumber } = require('./sendOrderEmail');
const blobStorage = require('./blobStorage');
const { isAllowedAudience } = require('./audiences');
const { PAGE_COUNT } = require('./pageCount');
const { isOwnImageUrl } = require('./generateArt');

// A real page is a few sentences; this only stops a hand-built request from
// stuffing the order email with a novel per page.
const MAX_PAGE_CHARS = 2000;

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
  if (!isAllowedAudience(book.audience)) problems.push('Unknown audience.');

  const data = (book.data && typeof book.data === 'object') ? book.data : {};
  for (const k of REQUIRED_BOOK_FIELDS[book.audience] || ['name']) {
    if (!str(data[k])) problems.push(`The book is missing "${k}".`);
  }
  // Catches a book that kept its placeholder subject even though data looks set.
  const names = str(book.names);
  if (!names || PLACEHOLDER_NAMES.indexOf(names.toLowerCase()) > -1) {
    problems.push('The book has not been personalised.');
  }

  // The book is photographed from the child's photo; without it there is
  // nothing to illustrate, and without consent we must not have it at all.
  // `photoConsent` must be the boolean true — a truthy string from a
  // hand-built request is not a tick in the box.
  if (!str(book.photo)) problems.push('No photo of the child.');
  if (book.photoConsent !== true) problems.push('Photo consent was not given.');
  // The email is the record of what the customer approved. Eleven pages of
  // AI-written text cannot be recreated later, so they must be in the order.
  if (!Array.isArray(book.pages) || book.pages.length !== PAGE_COUNT || !book.pages.every((p) => str(p))) {
    problems.push(`The book must have ${PAGE_COUNT} pages.`);
  } else if (book.pages.some((p) => p.length > MAX_PAGE_CHARS)) {
    problems.push('A page is too long.');
  }

  // Every picture must exist before the order is taken. The child's photo
  // is removed from the browser once the order is placed and lives only in
  // this email, so a picture missing now could never be taken later from
  // anything we hold. Each one must also be ours: a URL anywhere else is not
  // a picture we took of this child. (The cover is different: a missing
  // cover is honestly replaced by the typeset one, see placeOrder.)
  const plates = book.plateUrls;
  if (!Array.isArray(plates) || plates.length !== PAGE_COUNT || !plates.every(isOwnImageUrl)) {
    problems.push('Some pictures are still missing.');
  }

  if (!str(ship.who)) problems.push('No recipient name.');
  if (!EMAIL_RE.test(str(ship.email))) problems.push('No valid email address.');
  if (!str(ship.address)) problems.push('No delivery address.');

  return problems;
}

/**
 * A payment screenshot rides along as a data URL, same shape as a book photo.
 *
 * The Blob store is public, so the file name is the only thing between a
 * customer's bank-transfer screenshot and anyone on the internet. The order
 * number is kept in the key so the owner can find the file, but 96 random
 * bits follow it: the number alone must never be enough to fetch it. The
 * random part also means two orders that draw the same number cannot
 * overwrite, or refuse to overwrite, each other's screenshot.
 */
async function defaultSaveScreenshot(dataUrl, orderNum, save = blobStorage.save) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('payment_screenshot_malformed');
  const [, mimeType, b64] = m;
  const ext = mimeType.split('/')[1] || 'bin';
  const secret = crypto.randomBytes(12).toString('hex');
  return save(`farsh-orders/${orderNum}-${secret}.${ext}`, Buffer.from(b64, 'base64'), { contentType: mimeType });
}

/**
 * Validates, then sends. The email is the only record of the order, so this
 * resolves ONLY if the email actually went out.
 *
 * A payment screenshot, if supplied, must upload before the email is sent —
 * an order email with no way to verify payment is worse than no order at
 * all, so an upload failure fails the whole order rather than degrading
 * quietly to "no screenshot."
 *
 * @returns {Promise<{orderNumber: string}>}
 * @throws Error with .code 'invalid_order' (and .problems), 'screenshot_upload_failed',
 *   or the underlying send failure.
 */
async function placeOrder(payload, deps = {}) {
  const problems = validateOrder(payload);
  if (problems.length) {
    const err = new Error('invalid_order');
    err.code = 'invalid_order';
    err.problems = problems;
    throw err;
  }

  const orderNum = (deps.orderNumber || orderNumber)();
  const order = {
    orderNumber: orderNum,
    placedAt: (deps.now || (() => new Date()))().toISOString(),
    // A cover that is not ours is dropped to the typeset cover — honest stock
    // content — rather than refusing an otherwise complete order over it.
    book: { ...payload.book, coverUrl: isOwnImageUrl(payload.book.coverUrl) ? payload.book.coverUrl : null },
    ship: payload.ship,
    format: str(payload.format),
    speed: str(payload.speed),
    gift: !!payload.gift,
    total: str(payload.total),
  };

  if (payload.paymentScreenshot) {
    try {
      order.paymentScreenshotUrl = await (deps.saveScreenshot || defaultSaveScreenshot)(payload.paymentScreenshot, orderNum);
    } catch (err) {
      const e = new Error('screenshot_upload_failed: ' + err.message);
      e.code = 'screenshot_upload_failed';
      throw e;
    }
  }

  await (deps.send || sendOrderEmail)(order, deps.sendDeps);
  return { orderNumber: order.orderNumber };
}

module.exports = { defaultSaveScreenshot, placeOrder, validateOrder, REQUIRED_BOOK_FIELDS, PLACEHOLDER_NAMES };
