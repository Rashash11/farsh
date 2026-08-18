const test = require('node:test');
const assert = require('node:assert');
const { stripExif } = require('../lib/stripExif');

// Build a minimal fake JPEG: SOI, APP1 (Exif) segment, DQT segment, EOI.
function fakeJpegWithExif() {
  const soi = Buffer.from([0xff, 0xd8]);
  const exifBody = Buffer.from('Exif\0\0fakemetadata');
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1]),
    Buffer.from([(exifBody.length + 2) >> 8, (exifBody.length + 2) & 0xff]),
    exifBody,
  ]);
  const dqtBody = Buffer.from([0x00, 0x01, 0x02]);
  const dqt = Buffer.concat([
    Buffer.from([0xff, 0xdb]),
    Buffer.from([(dqtBody.length + 2) >> 8, (dqtBody.length + 2) & 0xff]),
    dqtBody,
  ]);
  const eoi = Buffer.from([0xff, 0xd9]);
  return { full: Buffer.concat([soi, app1, dqt, eoi]), withoutApp1: Buffer.concat([soi, dqt, eoi]) };
}

test('removes APP1 segment from a JPEG', () => {
  const { full, withoutApp1 } = fakeJpegWithExif();
  assert.deepStrictEqual(stripExif(full), withoutApp1);
});

test('returns non-JPEG buffers unchanged', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  assert.deepStrictEqual(stripExif(png), png);
});
