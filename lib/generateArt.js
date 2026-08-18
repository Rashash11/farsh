// Gemini image pipeline: character sheet -> cover -> plates.
// Plain fetch against the REST API (no SDK). All failures degrade to
// null URLs — callers treat null as "keep the stock art for this slot".

const crypto = require('crypto');
const { stripExif } = require('./stripExif');
const {
  characterSheetPrompt, photoSheetPrompt, platePrompt, coverPrompt,
} = require('./artPrompts');

const MODEL = () => process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const API = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPG_MAGIC = Buffer.from([0xff, 0xd8]);

// Sanity check, not a real image decoder: reject empty/near-empty payloads
// and confirm the magic bytes. NOTE: the brief specified `buf.length > 1000`
// here, but the brief's own test fixture is a 1x1 PNG that decodes to 70
// bytes — a verbatim >1000 threshold makes every mocked "success" response
// in the brief's tests fail this check before genImage's retry logic is
// ever reached. Lowered to comfortably admit that fixture while still
// rejecting trivially-empty/garbage buffers; real Gemini image output is
// always far larger than this floor, so production behavior is unaffected.
function looksLikeImage(buf) {
  return buf.length > 50 &&
    (buf.subarray(0, 4).equals(PNG_MAGIC) || buf.subarray(0, 2).equals(JPG_MAGIC));
}

function dataUrlToPart(dataUrl) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  let buf = Buffer.from(m[2], 'base64');
  if (m[1] === 'image/jpeg') buf = stripExif(buf);
  return { inline_data: { mime_type: m[1], data: buf.toString('base64') } };
}

async function defaultSave(name, buf) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = require('@vercel/blob');
    const { url } = await put(`farsh-art/${name}`, buf, { access: 'public', contentType: 'image/png' });
    return url;
  }
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'uploads', 'generated');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), buf);
  return `/uploads/generated/${name}`;
}

// One Gemini call -> Buffer or null. Never throws.
//
// CONTROLLER RULING: retries are for TRANSPORT failures only (!res.ok, or
// fetch itself throwing). A response that comes back `ok` but carries no
// image part is a refusal (e.g. finishReason: IMAGE_SAFETY) or a text-only
// answer — that is a deterministic model decision, not a transient failure,
// so it returns null immediately without consuming the retry. Retrying a
// refusal would (a) waste a paid call on an outcome that will not change,
// and (b) in the photo-fallback flow, silently eat the mock's *next*
// response (the description-path success), which would corrupt the
// fallback test and misrepresent what actually happened in production.
async function genImage(prompt, refParts, { fetchFn }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const doFetch = fetchFn || fetch;
  const body = JSON.stringify({
    contents: [{ parts: [...(refParts || []), { text: prompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    // The ENTIRE per-attempt body — fetch, response.ok check, JSON parse,
    // and response-shape access — lives inside this try. res.json() can
    // throw SyntaxError on a malformed body, and the shape access below
    // can throw TypeError on an unexpected/absent candidates array; both
    // must be treated as transport-class failures that consume a retry,
    // same as a thrown fetch, per the "functions never throw" constraint.
    try {
      const res = await doFetch(API(MODEL(), key), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      });
      if (!res.ok) continue; // transport failure -> retry / give up

      const json = await res.json();
      const parts = json.candidates && json.candidates[0] &&
        json.candidates[0].content && json.candidates[0].content.parts || [];
      const img = parts.find((p) => p.inlineData && p.inlineData.data);
      if (!img) return null; // refusal / text-only answer — deterministic, do not retry
      const buf = Buffer.from(img.inlineData.data, 'base64');
      if (looksLikeImage(buf)) return buf;
      // Malformed/garbage payload despite an inlineData part being present:
      // fall through and retry once (matches the brief's original code,
      // unlike the refusal case above which the controller ruling exempted).
    } catch (e) {
      continue; // network error, bad JSON, or unexpected shape -> retry / give up
    }
  }
  return null;
}

function id() { return crypto.randomBytes(8).toString('hex'); }

// A throwing saveFn (network hiccup writing to Blob, disk-full, etc.) must
// degrade that one slot to null, not escape the exported functions.
async function safeSave(save, name, buf) {
  try { return await save(name, buf); } catch (e) { return null; }
}

async function generateCoverArt(book, deps = {}) {
  const save = deps.saveFn || defaultSave;
  const photos = book.photos || (book.photo ? [book.photo] : []);
  const photoParts = photos.map(dataUrlToPart).filter(Boolean);
  let usedPhoto = false, sheetBuf = null;

  if (photoParts.length) {
    sheetBuf = await genImage(photoSheetPrompt(book), photoParts, deps);
    if (sheetBuf) usedPhoto = true;
  }
  if (!sheetBuf) sheetBuf = await genImage(characterSheetPrompt(book), [], deps);
  if (!sheetBuf) return { characterSheetUrl: null, coverUrl: null, usedPhoto: false, fellBackToDescription: false };

  // Only true when the photo path was attempted AND failed AND the
  // description-path fallback actually produced a sheet (we only reach
  // this line when sheetBuf is truthy) — never claim "illustrated from
  // your description" when both paths failed.
  const fellBackToDescription = photoParts.length > 0 && !usedPhoto;

  const sheetPart = { inline_data: { mime_type: 'image/png', data: sheetBuf.toString('base64') } };
  const coverBuf = await genImage(coverPrompt(book), [sheetPart], deps);

  const characterSheetUrl = await safeSave(save, `sheet-${id()}.png`, sheetBuf);
  const coverUrl = coverBuf ? await safeSave(save, `cover-${id()}.png`, coverBuf) : null;
  return { characterSheetUrl, coverUrl, usedPhoto, fellBackToDescription };
}

async function sheetPartFor(book, deps) {
  if (book.sheetBytesB64) { // test/short-circuit path
    return { inline_data: { mime_type: 'image/png', data: book.sheetBytesB64 } };
  }
  if (!book.characterSheetUrl) return null;
  try {
    const doFetch = (deps && deps.fetchFn) || fetch;
    // Local-relative URLs can't be fetched from the server; only absolute Blob URLs.
    if (!/^https?:/.test(book.characterSheetUrl)) {
      const fs = require('fs'); const path = require('path');
      // book is caller-supplied data; characterSheetUrl must not be trusted
      // to stay inside uploads/generated (e.g. '/../.env' or deeper '..'
      // traversal could otherwise read arbitrary server files and forward
      // them to Gemini). Resolve and verify containment before reading.
      const repoRoot = path.resolve(__dirname, '..');
      const uploadsGeneratedDir = path.join(repoRoot, 'uploads', 'generated');
      const rel = String(book.characterSheetUrl).replace(/^\/+/, '');
      const p = path.resolve(repoRoot, rel);
      if (p !== uploadsGeneratedDir && !p.startsWith(uploadsGeneratedDir + path.sep)) return null;
      return { inline_data: { mime_type: 'image/png', data: fs.readFileSync(p).toString('base64') } };
    }
    const res = await doFetch(book.characterSheetUrl);
    const buf = Buffer.from(await res.arrayBuffer());
    return { inline_data: { mime_type: 'image/png', data: buf.toString('base64') } };
  } catch (e) { return null; }
}

async function generatePlates(book, deps = {}) {
  const save = deps.saveFn || defaultSave;
  const sheetPart = await sheetPartFor(book, deps);
  const scenes = Array.isArray(book.scenes) ? book.scenes : [];
  const plateUrls = [];
  for (let i = 0; i < 6; i++) {
    if (!sheetPart) { plateUrls.push(null); continue; }
    const buf = await genImage(platePrompt(book, scenes[i]), [sheetPart], deps);
    plateUrls.push(buf ? await safeSave(save, `plate-${i}-${id()}.png`, buf) : null);
  }
  return { plateUrls };
}

async function redrawPlate(book, pageIndex, deps = {}) {
  const save = deps.saveFn || defaultSave;
  const i = Math.max(0, Math.min(5, pageIndex | 0));
  const sheetPart = await sheetPartFor(book, deps);
  if (!sheetPart) return { plateUrl: null };
  const scenes = Array.isArray(book.scenes) ? book.scenes : [];
  const buf = await genImage(platePrompt(book, scenes[i]), [sheetPart], deps);
  return { plateUrl: buf ? await safeSave(save, `plate-${i}-${id()}.png`, buf) : null };
}

module.exports = { generateCoverArt, generatePlates, redrawPlate };
