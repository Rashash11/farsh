// Tiny dependency-free rate limiter for the generation endpoints.
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
//
// Multiple named buckets share this same machinery, keyed independently —
// e.g. the image-generation routes get their own stricter allowance
// ('art') without disturbing the text-generation route's ('default').

const BUCKETS = {
  default: { perIpMax: 5, perIpWindowMs: 10 * 60 * 1000, globalMax: 60, globalWindowMs: 60 * 60 * 1000 },
  art: { perIpMax: 6, perIpWindowMs: 10 * 60 * 1000, globalMax: 60, globalWindowMs: 60 * 60 * 1000 },
};

// Back-compat named exports for the default bucket's numbers.
const PER_IP_MAX = BUCKETS.default.perIpMax;
const PER_IP_WINDOW_MS = BUCKETS.default.perIpWindowMs;
const GLOBAL_MAX = BUCKETS.default.globalMax;
const GLOBAL_WINDOW_MS = BUCKETS.default.globalWindowMs;

const state = new Map(); // bucketName -> { perIp: Map, globalHits: [] }

function stateFor(bucketName) {
  let s = state.get(bucketName);
  if (!s) { s = { perIp: new Map(), globalHits: [] }; state.set(bucketName, s); }
  return s;
}

function prune(arr, windowMs, now) {
  while (arr.length && now - arr[0] > windowMs) arr.shift();
}

/**
 * @param {string} ip
 * @param {string} [bucket] - which rate-limit bucket to check/count against;
 *   defaults to 'default' (today's behavior, unchanged callers/numbers).
 * @returns {null | {status: number, error: string, message: string, retryAfterSeconds: number}}
 *   null when the request is allowed (and counted); an error payload when limited.
 */
function checkRateLimit(ip, bucket = 'default') {
  const config = BUCKETS[bucket] || BUCKETS.default;
  const { perIp, globalHits } = stateFor(bucket);
  const now = Date.now();

  prune(globalHits, config.globalWindowMs, now);
  if (globalHits.length >= config.globalMax) {
    const retry = Math.ceil((globalHits[0] + config.globalWindowMs - now) / 1000);
    return {
      status: 429,
      error: 'rate_limited',
      message: 'The writer is fully booked right now — please try again in a little while.',
      retryAfterSeconds: Math.max(retry, 1),
    };
  }

  let hits = perIp.get(ip);
  if (!hits) { hits = []; perIp.set(ip, hits); }
  prune(hits, config.perIpWindowMs, now);
  if (hits.length >= config.perIpMax) {
    const retry = Math.ceil((hits[0] + config.perIpWindowMs - now) / 1000);
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
      prune(arr, config.perIpWindowMs, now);
      if (arr.length === 0) perIp.delete(key);
    }
  }

  return null;
}

module.exports = { checkRateLimit, PER_IP_MAX, PER_IP_WINDOW_MS, GLOBAL_MAX, GLOBAL_WINDOW_MS };
