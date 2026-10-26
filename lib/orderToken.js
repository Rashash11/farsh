// Signs and verifies the small order summary carried in the order email's
// Confirm/Reject links, so clicking one requires no database lookup — the
// signature itself is the only access control. See CLAUDE.md: there is no
// database; the email already *is* the order record, this just extends that
// to the confirm step.

const crypto = require('crypto');

function configuredSecret(deps) {
  const secret = deps.secret || process.env.ORDER_CONFIRM_SECRET;
  if (!secret) {
    const err = new Error('order_confirm_secret_not_configured');
    err.code = 'not_configured';
    throw err;
  }
  return secret;
}

function hmac(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest();
}

/** @returns {string} `<payload>.<signature>`, both base64url. */
function sign(summary, deps = {}) {
  const secret = configuredSecret(deps);
  const payload = Buffer.from(JSON.stringify(summary)).toString('base64url');
  const sig = hmac(secret, payload).toString('base64url');
  return `${payload}.${sig}`;
}

/**
 * @throws Error with .code 'not_configured' (no secret) or 'invalid_token'
 *   (malformed, tampered, or signed under a different secret) — never
 *   returns a summary it has not verified.
 */
function verify(token, deps = {}) {
  const secret = configuredSecret(deps);
  const invalid = () => {
    const err = new Error('invalid_order_token');
    err.code = 'invalid_token';
    throw err;
  };

  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 2) invalid();
  const [payload, sig] = parts;

  const expected = hmac(secret, payload);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) invalid();

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (err) {
    return invalid();
  }
}

module.exports = { sign, verify };
