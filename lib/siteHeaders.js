// What every response tells the browser, and which files in this repo must
// never be served.
//
// The site is deployed as "this whole directory, as static files" (see
// server.js and .vercelignore). That is simple, and it is also why lib/,
// test/ and the notes in *.md were downloadable from the live site: a
// serverless function needs lib/ in the upload, so .vercelignore cannot
// drop it. The fix is to refuse those paths at the edge instead. The list
// lives here, once; server.js applies it directly and vercel.json copies it
// (test/siteHeaders.test.js keeps the copy honest).
//
// The Content-Security-Policy is as tight as these pages allow, which for
// scripts is not very: they are dc-runtime templates whose logic sits in
// inline <script> blocks and is compiled with `new Function` (so
// 'unsafe-inline' and 'unsafe-eval'), and support.js pulls React from
// unpkg.com. What the policy still buys is frame-ancestors (no clickjacking
// of the confirm page), a fixed list of hosts for scripts, fonts and
// images, form-action and base-uri pinned to us, and connect-src 'self' so
// nothing on the page can post a child's photo anywhere but our own API.

const BLOB_HOSTS = 'https://*.public.blob.vercel-storage.com';

const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src \'self\' data: https://fonts.gstatic.com',
    `img-src 'self' data: blob: ${BLOB_HOSTS}`,
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
});

// Directories that hold code, tests or notes rather than the site. On Vercel
// these are redirects, not rewrites: rewrites run after the filesystem and
// so cannot hide a file that exists in the upload. api/ is
// listed because on Vercel the function's *source* also sits in the static
// tree. Everything under a dot-directory or dot-file is private by nature.
const HIDDEN_DIRS = ['lib', 'test', 'docs', 'tools', 'api', 'node_modules'];
const HIDDEN_FILES = ['server.js', 'package.json', 'package-lock.json'];

/** @param {string} pathname - the request path, before or after URL decoding */
function isHiddenPath(pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { p = pathname; }
  const parts = p.split('/').filter(Boolean);
  if (parts.length === 0) return false;
  if (parts.some((seg) => seg.startsWith('.'))) return true;
  if (HIDDEN_DIRS.includes(parts[0])) {
    // "/api/place-order" is the route, served by the handler registered
    // before the static middleware; "/api/place-order.js" would be its source.
    return parts[0] !== 'api' || /\.[cm]?js$/.test(parts[parts.length - 1]);
  }
  if (parts.length === 1 && HIDDEN_FILES.includes(parts[0])) return true;
  return /\.md$/i.test(parts[parts.length - 1]);
}

module.exports = { SECURITY_HEADERS, isHiddenPath };
