// Tiny dependency-free rate limiter for the generation endpoint.
//
// Two layers, both sliding windows kept in memory:
//   - per-IP:  each visitor gets a small personal allowance
//   - global:  a hard ceiling across ALL visitors, so even a botnet of
//              fresh IPs can't burn API credits faster than this cap
//
// In-memory means per-process: on serverless hosts each warm instance has
// its own counters, so the caps are per-instance there (still a real brake
// on abuse, not a precise global guarantee). For this product that's the
// right tradeoff — a book generation costs real money, but a missed limit
// by 2x is survivable; adding Redis is not worth it yet.

const PER_IP_MAX = 5;              // generations per IP...
const PER_IP_WINDOW_MS = 10 * 60 * 1000;   // ...per 10 minutes
const GLOBAL_MAX = 60;             // generations across everyone...
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;   // ...per hour

const perIp = new Map();   // ip -> [timestamps]
const globalHits = [];     // [timestamps]

function prune(arr, windowMs, now) {
  while (arr.length && now - arr[0] > windowMs) arr.shift();
}

/**
 * @returns {null | {status: number, error: string, message: string, retryAfterSeconds: number}}
 *   null when the request is allowed (and counted); an error payload when limited.
 */
function checkRateLimit(ip) {
  const now = Date.now();

  prune(globalHits, GLOBAL_WINDOW_MS, now);
  if (globalHits.length >= GLOBAL_MAX) {
    const retry = Math.ceil((globalHits[0] + GLOBAL_WINDOW_MS - now) / 1000);
    return {
      status: 429,
      error: 'rate_limited',
      message: 'The writer is fully booked right now — please try again in a little while.',
      retryAfterSeconds: Math.max(retry, 1),
    };
  }

  let hits = perIp.get(ip);
  if (!hits) { hits = []; perIp.set(ip, hits); }
  prune(hits, PER_IP_WINDOW_MS, now);
  if (hits.length >= PER_IP_MAX) {
    const retry = Math.ceil((hits[0] + PER_IP_WINDOW_MS - now) / 1000);
    return {
      status: 429,
      error: 'rate_limited',
      message: 'You have written a few books in a row — give the writer a few minutes and try again.',
      retryAfterSeconds: Math.max(retry, 1),
    };
  }

  hits.push(now);
  globalHits.push(now);

  // keep the map from growing unboundedly on long-running servers
  if (perIp.size > 10000) {
    for (const [key, arr] of perIp) {
      prune(arr, PER_IP_WINDOW_MS, now);
      if (arr.length === 0) perIp.delete(key);
    }
  }

  return null;
}

module.exports = { checkRateLimit, PER_IP_MAX, PER_IP_WINDOW_MS, GLOBAL_MAX, GLOBAL_WINDOW_MS };
