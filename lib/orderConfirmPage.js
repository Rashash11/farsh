// Tiny server-rendered pages for the order email's "Review & confirm" link —
// no dc-runtime, no framework, just enough HTML for you to look at the order
// and click a button. The GET page only renders; it has no side effects, so
// an email client or security scanner prefetching the link can't trigger a
// confirm/reject by itself — only the POST (the actual button click) does.

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function page(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Farsh!</title></head>
<body style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:0 16px;">
${body}
</body></html>`;
}

function renderReviewPage(summary, token) {
  const button = (action, label) => `
<form method="POST" action="/api/order-confirm" style="display:inline-block;margin-right:12px;">
  <input type="hidden" name="token" value="${esc(token)}">
  <input type="hidden" name="action" value="${action}">
  <button type="submit">${label}</button>
</form>`;

  return page('Confirm payment', `
<h1>Order ${esc(summary.orderNumber)}</h1>
<p>Names: ${esc(summary.names)}</p>
<p>Customer email: ${esc(summary.email)}</p>
<p>Total: ${esc(summary.total)}</p>
<p>Check the screenshot linked in the order email, then:</p>
${button('confirm', 'Confirm payment')}
${button('reject', 'Reject payment')}
`);
}

function renderResultPage({ orderNumber, action }) {
  const verb = action === 'confirm' ? 'confirmed' : 'rejected';
  return page('Payment ' + verb, `<h1>Order ${esc(orderNumber)} ${verb}</h1><p>The customer has been emailed.</p>`);
}

function renderErrorPage(message) {
  return page('Error', `<h1>Something went wrong</h1><p>${esc(message)}</p>`);
}

module.exports = { renderReviewPage, renderResultPage, renderErrorPage };
