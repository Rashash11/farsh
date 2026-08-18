// Removes EXIF-class metadata (APP1/APP2 segments) from a JPEG buffer.
// Defense-in-depth: the client already re-encodes photos via <canvas>
// (which drops EXIF), but the server must not rely on the client.

function stripExif(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    return buf; // not a JPEG — leave untouched
  }
  const out = [Buffer.from([0xff, 0xd8])];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) break; // malformed — keep the rest as-is
    const marker = buf[i + 1];
    if (marker === 0xd9 || marker === 0xda) {
      // EOI or start-of-scan: copy everything remaining verbatim
      out.push(buf.subarray(i));
      i = buf.length;
      break;
    }
    const segLen = buf.readUInt16BE(i + 2);
    const seg = buf.subarray(i, i + 2 + segLen);
    if (marker !== 0xe1 && marker !== 0xe2) out.push(seg); // drop APP1/APP2
    i += 2 + segLen;
  }
  if (i < buf.length) out.push(buf.subarray(i));
  return Buffer.concat(out);
}

module.exports = { stripExif };
