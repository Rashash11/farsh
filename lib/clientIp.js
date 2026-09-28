// Works out who a request is actually from, for rate-limiting purposes.
//
// THE TRAP: `x-forwarded-for` is a comma-separated chain, and each proxy
// APPENDS to the right. The leftmost entry is therefore whatever the original
// client chose to put there — it is user input, not an identity. Keying a rate
// limiter on it means anyone can hand themselves a fresh allowance per request
// by rotating a header, which defeats the limiter entirely.
//
// So, in order of preference:
//
//   1. `x-vercel-forwarded-for` / `x-real-ip` — the hosting platform sets these
//      itself and overwrites anything the client sent, so they can be trusted.
//   2. The RIGHTMOST `x-forwarded-for` entry — appended by the nearest proxy,
//      i.e. the one hop we can actually vouch for.
//   3. The socket address.
//
// Forwarded headers are only consulted when we are actually behind a proxy
// (`VERCEL` is set, or `TRUST_PROXY=1`). Running locally with no proxy in
// front, every forwarded header is pure client input and is ignored outright —
// otherwise `curl -H 'X-Forwarded-For: ...'` walks straight past the limiter in
// dev, which is exactly how this bug was found.

function behindProxy(env = process.env) {
  return Boolean(env.VERCEL || env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true');
}

function header(headers, name) {
  let v = headers[name];
  if (Array.isArray(v)) v = v[v.length - 1];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// Last hop of a comma-separated forwarding chain.
function lastHop(chain) {
  const parts = chain.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

// `::ffff:1.2.3.4` -> `1.2.3.4`; `1.2.3.4:5678` -> `1.2.3.4`;
// `[::1]:5678` -> `::1`. Bare IPv6 is left alone — its colons are not a port.
function normalize(ip) {
  if (!ip) return null;
  let out = ip.trim();
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(out);
  if (bracketed) out = bracketed[1];
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(out);
  if (v4WithPort) out = v4WithPort[1];
  if (/^::ffff:/i.test(out)) out = out.slice(7);
  return out.toLowerCase() || null;
}

/**
 * @param {{headers?: object, socket?: {remoteAddress?: string}}} req
 * @param {object} [env] - injectable for tests; defaults to process.env
 * @returns {string} a stable key for this client, or 'unknown'
 */
function clientIp(req, env = process.env) {
  const headers = (req && req.headers) || {};

  if (behindProxy(env)) {
    const platform = header(headers, 'x-vercel-forwarded-for') || header(headers, 'x-real-ip');
    if (platform) {
      const ip = normalize(lastHop(platform));
      if (ip) return ip;
    }
    const fwd = header(headers, 'x-forwarded-for');
    if (fwd) {
      const ip = normalize(lastHop(fwd));
      if (ip) return ip;
    }
  }

  return normalize(req && req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = { clientIp, behindProxy };
