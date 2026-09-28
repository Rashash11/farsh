const test = require('node:test');
const assert = require('node:assert');
const { placeOrder, validateOrder } = require('../lib/placeOrder');
const { composeOrderEmail, sendOrderEmail, orderNumber } = require('../lib/sendOrderEmail');

const goodBook = () => ({
  audience: 'child', direction: 0, title: 'Layla and the door in the garden wall',
  names: 'Layla', tags: ['Dinosaurs'], dedication: 'For Layla, from Baba',
  photo: null, photoConsent: false, data: { name: 'Layla', age: '7', looks: 'red curly hair' },
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

test('a couple book needs both names', () => {
  const o = goodOrder();
  o.book.audience = 'couple';
  o.book.names = 'Noor';
  o.book.data = { name: 'Noor' };
  assert.ok(validateOrder(o).some((p) => /missing "partner"/.test(p)));
  o.book.data.partner = 'Sami';
  assert.deepStrictEqual(validateOrder(o), []);
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
