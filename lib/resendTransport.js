// Thin wrapper around the Resend REST API, shared by anything that sends a
// transactional email (order confirmations, payment decisions). Extracted
// out of lib/sendOrderEmail.js so the "nothing is swallowed, every failure
// path throws" discipline lives in one place rather than being copied.

const RESEND_ENDPOINT = process.env.RESEND_ENDPOINT || 'https://api.resend.com/emails';

/**
 * @param {{to: string[], from: string, subject: string, text: string, replyTo?: string}} message
 * @param {object} [deps] - { apiKey, fetchFn } for tests
 * @returns {Promise<{id: string}>}
 * @throws when unconfigured, when Resend rejects, or when the network fails.
 */
async function sendEmail(message, deps = {}) {
  const apiKey = deps.apiKey || process.env.RESEND_API_KEY;
  const doFetch = deps.fetchFn || fetch;

  if (!apiKey) throw new Error('email_not_configured');

  let res;
  try {
    res = await doFetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...message, reply_to: message.replyTo || undefined }),
    });
  } catch (err) {
    throw new Error('email_transport_failed: ' + err.message);
  }

  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch (e) { /* body may not be JSON */ }
    throw new Error(`email_rejected: ${res.status} ${detail}`);
  }

  const json = await res.json().catch(() => ({}));
  return { id: json.id || '' };
}

module.exports = { sendEmail };
