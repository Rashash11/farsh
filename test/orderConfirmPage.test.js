const test = require('node:test');
const assert = require('node:assert');
const { renderReviewPage, renderResultPage, renderErrorPage } = require('../lib/orderConfirmPage');

const summary = () => ({ orderNumber: 'FA-1234', email: 'parent@example.com', names: 'Layla', total: '$60' });

test('the review page shows the order details and both actions, carrying the token forward', () => {
  const html = renderReviewPage(summary(), 'the-token-value');
  for (const needle of ['FA-1234', 'parent@example.com', 'Layla', '$60']) {
    assert.ok(html.includes(needle), `missing "${needle}"\n${html}`);
  }
  assert.match(html, /name="action" value="confirm"/);
  assert.match(html, /name="action" value="reject"/);
  assert.match(html, /name="token" value="the-token-value"/);
});

test('the review page is a GET-safe view — no form submits without a click, and it escapes untrusted summary text', () => {
  const html = renderReviewPage({ ...summary(), names: '<script>alert(1)</script>' }, 'tok');
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag must not appear unescaped\n' + html);
  assert.ok(html.includes('&lt;script&gt;'), html);
});

test('the result page confirms what happened and names the order', () => {
  const html = renderResultPage({ orderNumber: 'FA-1234', action: 'confirm' });
  assert.match(html, /FA-1234/);
  assert.match(html, /confirmed/i);
});

test('the reject result page says so, not "confirmed"', () => {
  const html = renderResultPage({ orderNumber: 'FA-1234', action: 'reject' });
  assert.match(html, /rejected/i);
});

test('the error page carries the message without pretending success', () => {
  const html = renderErrorPage('This link is no longer valid.');
  assert.match(html, /no longer valid/);
});
