// Shared storage for anything saved as a file during an order or a book:
// Vercel Blob in production, uploads/generated/ locally — same tradeoff as
// generated art (see lib/generateArt.js), now shared with payment
// screenshots rather than reimplemented.

/**
 * @param {string} key - full Blob key, e.g. "farsh-orders/FA-1234.jpg"
 * @param {Buffer} buf
 * @param {{contentType: string}} opts
 * @returns {Promise<string>} a URL (Blob) or a local path under /uploads/generated/
 */
async function save(key, buf, { contentType }) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = require('@vercel/blob');
    const { url } = await put(key, buf, { access: 'public', contentType });
    return url;
  }
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'uploads', 'generated');
  fs.mkdirSync(dir, { recursive: true });
  const name = path.basename(key);
  fs.writeFileSync(path.join(dir, name), buf);
  return `/uploads/generated/${name}`;
}

module.exports = { save };
