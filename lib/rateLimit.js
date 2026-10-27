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
  // Art is counted in IMAGES, not requests: one plates request is eleven
  // paid image calls, a cover or a redraw is one. 30 per visitor per ten
  // minutes is two full books plus a handful of redraws; the global ceiling
  // is an hourly image budget per instance.
  art: { perIpMax: 30, perIpWindowMs: 10 * 60 * 1000, globalMax: 300, globalWindowMs: 60 * 60 * 1000 },
  // Orders are rarer and more precious than generations: a person placing more
  // than a handful in ten minutes is a mistake or abuse, but the global ceiling
  // is generous so a busy day never turns customers away.
  order: { perIpMax: 5, perIpWindowMs: 10 * 60 * 1000, globalMax: 200, globalWindowMs: 60 * 60 * 1000 },
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
 * @param {number} [weight=1] - how many units this request spends (images for the 'art' bucket).
 *   A weighted request is admitted or refused whole: if it would cross the cap, nothing is counted.
 * @returns {null | {status: number, error: string, message: string, retryAfterSeconds: number}}
 *   null when the request is allowed (and counted); an error payload when limited.
 */
function checkRateLimit(ip, bucket = 'default', weight = 1) {
  const config = BUCKETS[bucket] || BUCKETS.default;
  const { perIp, globalHits } = stateFor(bucket);
  const now = Date.now();
  const w = Math.max(1, weight | 0);

  prune(globalHits, config.globalWindowMs, now);
  if (globalHits.length + w > config.globalMax) {
    // A weight larger than the cap can never be admitted, so the oldest hit
    // may not exist (empty window). Then the whole window is the honest wait.
    const oldest = globalHits[0];
    const retry = oldest === undefined
      ? Math.ceil(config.globalWindowMs / 1000)
      : Math.ceil((oldest + config.globalWindowMs - now) / 1000);
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
  if (hits.length + w > config.perIpMax) {
    // Same reasoning as the global check: a weight above the per-IP cap can
    // never be admitted, so with no recorded hits the full window is the answer.
    const oldest = hits[0];
    const retry = oldest === undefined
      ? Math.ceil(config.perIpWindowMs / 1000)
      : Math.ceil((oldest + config.perIpWindowMs - now) / 1000);
    return {
      status: 429,
      error: 'rate_limited',
      message: 'You have written a few books in a row — give the writer a few minutes and try again.',
      retryAfterSeconds: Math.max(retry, 1),
    };
  }

  for (let i = 0; i < w; i++) { hits.push(now); globalHits.push(now); }

  // keep the map from growing unboundedly on long-running servers
  if (perIp.size > 10000) {
    for (const [key, arr] of perIp) {
      prune(arr, config.perIpWindowMs, now);
      if (arr.length === 0) perIp.delete(key);
    }
  }

  return null;
}

module.exports = { checkRateLimit, BUCKETS, PER_IP_MAX, PER_IP_WINDOW_MS, GLOBAL_MAX, GLOBAL_WINDOW_MS };
