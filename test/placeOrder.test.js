const test = require('node:test');
const assert = require('node:assert');
const { placeOrder, validateOrder } = require('../lib/placeOrder');
const { composeOrderEmail, sendOrderEmail, orderNumber } = require('../lib/sendOrderEmail');
const { verify } = require('../lib/orderToken');
const { PAGE_COUNT } = require('../lib/pageCount');

const SECRET = 'test-secret-do-not-use-in-prod';

const PHOTO = 'data:image/jpeg;base64,/9j/AAAA';
const goodBook = () => ({
  audience: 'child', direction: 0, title: 'Layla and the door in the garden wall',
  names: 'Layla', tags: ['Dinosaurs'], dedication: 'For Layla, from Baba',
  photo: PHOTO, photoConsent: true, data: { name: 'Layla', age: '7', looks: 'red curly hair' },
  pages: Array.from({ length: PAGE_COUNT }, (_, i) => `Page ${i + 1} text.`),
  coverUrl: 'https://x.public.blob.vercel-storage.com/farsh-art/cover-1.png',
  plateUrls: Array.from({ length: PAGE_COUNT }, (_, i) => (i === 4 ? null : `https://x.public.blob.vercel-storage.com/farsh-art/plate-${i}.png`)),
});
const goodShip = () => ({ who: 'Parent Name', email: 'parent@example.com', address: '12 Nile St, Cairo', note: '' });
const goodOrder = () => ({ book: goodBook(), ship: goodShip(), format: 'Hardcover', speed: 'Rush · 3 days', gift: true, total: '$60' });

// --- validation: the server must not trust the browser -----------------------

test('a complete order validates', () => {
  assert.deepStrictEqual(validateOrder(goodOrder()), []);
});

test('an unpersonalised book is refused even if the UI let it through', () => {
  const o = goodOrder();
  o.book.names = 'Your kid';
  o.book.data = {};
  const problems = validateOrder(o);
  assert.ok(problems.some((p) => /not been personalised/.test(p)), problems.join(' '));
  assert.ok(problems.some((p) => /missing "name"/.test(p)), problems.join(' '));
});

// Farsh! sells only the child book for now. The couple and family code paths
// still exist in lib (prompts, fields) but an order for them must be refused
// here, whatever the UI did, so nothing nobody can fulfil gets emailed.
test('a complete couple book is refused while only the child book is sold', () => {
  const o = goodOrder();
  o.book.audience = 'couple';
  o.book.names = 'Noor & Sami';
  o.book.data = { name: 'Noor', partner: 'Sami' };
  assert.ok(validateOrder(o).some((p) => /Unknown audience/.test(p)), validateOrder(o).join(' '));
});

test('a complete family book is refused while only the child book is sold', () => {
  const o = goodOrder();
  o.book.audience = 'family';
  o.book.names = 'The Haddads';
  o.book.data = { name: 'The Haddads' };
  assert.ok(validateOrder(o).some((p) => /Unknown audience/.test(p)), validateOrder(o).join(' '));
});

test('the sold audiences are exported so the routes refuse the same set', () => {
  const { ALLOWED_AUDIENCES } = require('../lib/audiences');
  assert.deepStrictEqual(ALLOWED_AUDIENCES, ['child']);
});

test('shipping details are re-checked server side', () => {
  for (const [field, bad] of [['who', ''], ['email', 'nope'], ['address', '   ']]) {
    const o = goodOrder();
    o.ship[field] = bad;
    assert.ok(validateOrder(o).length > 0, `${field}="${bad}" should be refused`);
  }
});

test('a request with no book at all is refused, not crashed on', () => {
  assert.ok(validateOrder({}).length > 0);
  assert.ok(validateOrder(null).length > 0);
  assert.ok(validateOrder({ book: 'not-an-object' }).length > 0);
});

// --- the email is the record -------------------------------------------------

test('the email carries everything needed to make the book', () => {
  const { subject, text } = composeOrderEmail({ ...goodOrder(), orderNumber: 'FA-1234', placedAt: '2026-09-28T00:00:00.000Z' });
  assert.match(subject, /FA-1234/);
  assert.match(subject, /Layla/);
  for (const needle of ['Layla', 'red curly hair', 'Dinosaurs', 'For Layla, from Baba',
                        'Hardcover', 'Rush · 3 days', '$60', 'Parent Name',
                        'parent@example.com', '12 Nile St, Cairo']) {
    assert.ok(text.includes(needle), `email is missing "${needle}"\n${text}`);
  }
});

test('the email flags a photo supplied without consent', () => {
  const o = { ...goodOrder(), orderNumber: 'FA-1', placedAt: 'now' };
  o.book.photo = 'data:image/jpeg;base64,AAAA';
  o.book.photoConsent = false;
  assert.match(composeOrderEmail(o).text, /consent NOT given/);
});

test('empty optional fields are left out rather than printed blank', () => {
  const o = { ...goodOrder(), orderNumber: 'FA-1', placedAt: 'now' };
  o.book.dedication = '';
  o.ship.note = '';
  const { text } = composeOrderEmail(o);
  assert.ok(!/Dedication:\s*$/m.test(text));
  assert.ok(!/Note on the card:\s*$/m.test(text));
});

test('an order with no payment screenshot has no PAYMENT section', () => {
  const { text } = composeOrderEmail({ ...goodOrder(), orderNumber: 'FA-1', placedAt: 'now' });
  assert.ok(!/PAYMENT/.test(text));
});

test('an order with a payment screenshot gets a PAYMENT section with the screenshot url and a review link', () => {
  const o = { ...goodOrder(), orderNumber: 'FA-1234', placedAt: 'now', paymentScreenshotUrl: 'https://blob.example/FA-1234.png' };
  const { text } = composeOrderEmail(o, { secret: SECRET, baseUrl: 'https://farsh.example' });
  assert.match(text, /PAYMENT/);
  assert.ok(text.includes('https://blob.example/FA-1234.png'), text);
  const linkMatch = /https:\/\/farsh\.example\/api\/order-confirm\?token=(\S+)/.exec(text);
  assert.ok(linkMatch, 'expected a review link in the email\n' + text);
  const token = decodeURIComponent(linkMatch[1]);
  const summary = verify(token, { secret: SECRET });
  assert.strictEqual(summary.orderNumber, 'FA-1234');
  assert.strictEqual(summary.email, 'parent@example.com');
  assert.strictEqual(summary.total, '$60');
});

test('composing an order email for a paid screenshot without ORDER_CONFIRM_SECRET configured fails loudly, not silently omits the link', () => {
  const o = { ...goodOrder(), orderNumber: 'FA-1', placedAt: 'now', paymentScreenshotUrl: 'https://blob.example/x.png' };
  assert.throws(() => composeOrderEmail(o, { secret: '' }), (err) => err.code === 'not_configured');
});

test('order numbers look like FA-####', () => {
  assert.match(orderNumber(() => 0), /^FA-\d{4}$/);
  assert.match(orderNumber(() => 0.999), /^FA-\d{4}$/);
});

// --- failure must never look like success ------------------------------------

test('an unconfigured mailer throws rather than silently dropping the order', async () => {
  await assert.rejects(
    () => sendOrderEmail({ orderNumber: 'FA-1', placedAt: 'now', book: goodBook(), ship: goodShip() }, { apiKey: '', to: 'a@b.co' }),
    /email_not_configured/,
  );
});

test('a rejection from Resend surfaces as an error', async () => {
  const fetchFn = async () => ({ ok: false, status: 422, json: async () => ({ message: 'domain not verified' }) });
  await assert.rejects(
    () => sendOrderEmail({ orderNumber: 'FA-1', placedAt: 'now', book: goodBook(), ship: goodShip() },
      { apiKey: 'k', to: 'a@b.co', fetchFn }),
    /email_rejected: 422/,
  );
});

test('a network failure surfaces as an error', async () => {
  const fetchFn = async () => { throw new Error('ECONNRESET'); };
  await assert.rejects(
    () => sendOrderEmail({ orderNumber: 'FA-1', placedAt: 'now', book: goodBook(), ship: goodShip() },
      { apiKey: 'k', to: 'a@b.co', fetchFn }),
    /email_transport_failed/,
  );
});

test('placeOrder resolves with a number only after the email is sent', async () => {
  const sent = [];
  const res = await placeOrder(goodOrder(), {
    send: async (order) => { sent.push(order); },
    orderNumber: () => 'FA-9999',
    now: () => new Date('2026-09-28T12:00:00Z'),
  });
  assert.strictEqual(res.orderNumber, 'FA-9999');
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].orderNumber, 'FA-9999');
  assert.strictEqual(sent[0].total, '$60');
});

test('placeOrder does not swallow a send failure', async () => {
  await assert.rejects(
    () => placeOrder(goodOrder(), { send: async () => { throw new Error('email_rejected: 500'); } }),
    /email_rejected/,
  );
});

test('placeOrder refuses an invalid order before trying to send', async () => {
  let attempted = false;
  const bad = goodOrder();
  bad.ship.email = 'not-an-email';
  await assert.rejects(
    () => placeOrder(bad, { send: async () => { attempted = true; } }),
    (err) => err.code === 'invalid_order' && err.problems.length > 0,
  );
  assert.strictEqual(attempted, false, 'must not contact the mailer for an invalid order');
});

// --- payment screenshot --------------------------------------------------

test('an order with no payment screenshot never attempts an upload', async () => {
  let uploadAttempted = false;
  await placeOrder(goodOrder(), {
    send: async () => {},
    saveScreenshot: async () => { uploadAttempted = true; return 'https://blob/should-not-happen'; },
  });
  assert.strictEqual(uploadAttempted, false);
});

test('an order with a payment screenshot uploads it, and the order the mailer sees carries the url', async () => {
  const sent = [];
  const order = { ...goodOrder(), paymentScreenshot: 'data:image/png;base64,AAAA' };
  await placeOrder(order, {
    send: async (o) => sent.push(o),
    saveScreenshot: async (dataUrl, orderNum) => `https://blob.example/${orderNum}.png`,
    orderNumber: () => 'FA-7777',
  });
  assert.strictEqual(sent[0].paymentScreenshotUrl, 'https://blob.example/FA-7777.png');
});

test('a failed screenshot upload fails the whole order, and no email is sent', async () => {
  let sendAttempted = false;
  const order = { ...goodOrder(), paymentScreenshot: 'data:image/png;base64,AAAA' };
  await assert.rejects(
    () => placeOrder(order, {
      send: async () => { sendAttempted = true; },
      saveScreenshot: async () => { throw new Error('blob_put_failed: network error'); },
    }),
    (err) => err.code === 'screenshot_upload_failed',
  );
  assert.strictEqual(sendAttempted, false, 'must not email an order whose screenshot never saved');
});

test('an order without a photo is refused', () => {
  const o = goodOrder();
  o.book.photo = null;
  assert.ok(validateOrder(o).some((p) => /photo/i.test(p)));
});

test('an order whose photo consent is not exactly true is refused', () => {
  for (const bad of [false, 'true', 1, undefined]) {
    const o = goodOrder();
    o.book.photoConsent = bad;
    assert.ok(validateOrder(o).some((p) => /consent/i.test(p)), String(bad));
  }
});

test('an order must carry exactly PAGE_COUNT pages of text', () => {
  const o = goodOrder();
  o.book.pages = o.book.pages.slice(0, 3);
  assert.ok(validateOrder(o).some((p) => /pages/i.test(p)));
  o.book.pages = undefined;
  assert.ok(validateOrder(o).some((p) => /pages/i.test(p)));
});

test('the email carries every page, the cover, and each plate or "missing"', () => {
  const o = { ...goodOrder(), orderNumber: 'FA-1234', placedAt: '2026-10-26T10:00:00.000Z' };
  const { text } = composeOrderEmail(o, { secret: SECRET });
  assert.match(text, /THE PAGES/);
  for (let i = 1; i <= PAGE_COUNT; i++) assert.ok(text.includes(`  ${i}: Page ${i} text.`), 'page ' + i);
  assert.match(text, /Cover: https:\/\/x\.public/);
  assert.match(text, /Plate 5: missing/);
  assert.match(text, /Plate 1: https:\/\/x\.public/);
});
