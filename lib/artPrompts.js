// Pure prompt builders for book illustrations. No network, no state —
// everything here is snapshot-testable. Style blocks are versioned by
// being literal strings: change one and the artFingerprint stays the
// same on purpose (style tweaks should not invalidate every cached book).
//
// The child book is photographed, not painted: the owner's brief asks for
// frames from a live-action fairytale film, with the real child's face
// preserved from their photo. Couple/family blocks below are dormant (only
// the child book is sold, see lib/audiences.js) and keep the old painted
// wording until someone decides what those books should look like.

const CONSTRAINTS =
  'Photorealistic cinematic photograph only: real skin texture, real hair ' +
  'strands, natural eyes, physically plausible light and shadow, natural ' +
  'body proportions, believable fabric and objects. Never cartoon, anime, ' +
  'Pixar/3D, doll-like, painterly or beauty-filtered. No text, letters, ' +
  'numbers, borders or watermarks in the image. One single coherent scene.';

// The master brief's Part 1. Identity outranks every other instruction in
// the prompt, so it is stated once, verbatim, in every image call.
const IDENTITY =
  'The attached photograph is the child. Keep this exact child: face shape, ' +
  'forehead and hairline, hair texture and curls, eyebrows, eye shape and ' +
  'colour, nose, cheeks, lips, chin, ears, skin tone, and apparent age. ' +
  'Never age the child up. Clothing, hairstyling details, pose, expression, ' +
  'background, lighting and camera angle may change; the face may not. If ' +
  'the scene and the identity conflict, identity wins.';

const BASE_MEDIUM =
  'photorealistic cinematic still from a high-budget live-action fairytale ' +
  'film, shot on a cinema camera, shallow depth of field, rich believable colour';

const MOODS = [
  { key: 'golden', title: 'Golden Hour' },
  { key: 'moonlit', title: 'Moonlit' },
  { key: 'kingdom', title: 'Storybook Kingdom' },
];

const STYLE_BLOCKS = {
  child: {
    0: `Golden Hour: ${BASE_MEDIUM}, warm low sun, long soft shadows, sunlit meadows, gardens and village lanes.`,
    1: `Moonlit: ${BASE_MEDIUM}, blue night, moonlight and lantern light, stars, quiet and dreamlike.`,
    2: `Storybook Kingdom: ${BASE_MEDIUM}, castle stone, banners, candlelit halls, bright clear daylight outdoors.`,
  },
  // These blocks are unreachable while only the child book is sold (see
  // lib/audiences.js). CONSTRAINTS, IDENTITY and subjectFor are child-only and
  // must be rewritten before any other audience is re-enabled.
  couple: {
    0: 'Midnight Velvet style: painted storybook illustration, gouache and colored-pencil texture, deep quiet palette of wine and midnight blue, intimate low light, very few elements per scene.',
    1: 'Letter Press style: painted storybook illustration, gouache and colored-pencil texture, vintage letterpress texture on thick cream paper, muted inks, classical and nostalgic.',
    2: 'Paper Garden style: painted storybook illustration, gouache and colored-pencil texture, botanical margins, soft floral colors, lots of white space, delicate organic shapes.',
  },
  family: {
    0: 'Kitchen Table style: painted storybook illustration, gouache and colored-pencil texture, warm domestic light, handwriting-adjacent looseness, everyone mid-conversation.',
    1: 'The Album style: painted storybook illustration, gouache and colored-pencil texture, composed like mounted photographs with painted captions-space, sepia-warmed colors.',
    2: 'Long Table style: painted storybook illustration, gouache and colored-pencil texture, wide tableaus like places set for dinner, earthy welcoming palette.',
  },
};

// Same bounding discipline as lib/generateBook.js: every user-typed field
// that lands in a paid image call is flattened to one line and capped.
const LIMITS = { scene: 300, title: 200, looks: 300, age: 10 };

function clampField(value, max) {
  // A numeric age (7) is legitimate input from the builder; only a string or
  // a finite number is renderable, everything else collapses to ''.
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value !== 'string') return '';
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() + '…' : flat;
}

function styleFor(book) {
  const aud = ['child', 'couple', 'family'].includes(book.audience) ? book.audience : 'child';
  const dir = [0, 1, 2].includes(book.direction) ? book.direction : 0;
  return STYLE_BLOCKS[aud][dir];
}

function subjectFor(book) {
  const d = (book.data && typeof book.data === 'object') ? book.data : {};
  const age = clampField(d.age, LIMITS.age);
  const looks = clampField(d.looks, LIMITS.looks);
  return `a ${age ? `${age}-year-old` : 'young'} child${looks ? `, ${looks}` : ''}. Natural expression, age-appropriate clothing.`;
}

function platePrompt(book, scene) {
  const sceneText = clampField(scene, LIMITS.scene) || 'a quiet, warm moment from the story';
  // Do not stack a second full stop on a scene that already ends in one (or
  // in the clamp's ellipsis).
  const sceneEnd = /[.…]$/.test(sceneText) ? '' : '.';
  return `${IDENTITY}
Subject: ${subjectFor(book)}
Scene: ${sceneText}${sceneEnd}
${styleFor(book)}
Square 1:1 composition. The child clearly visible and actively doing what the scene says. Keep calm negative space on one side as room for text. Other people, if any, at a distance or seen from behind.
${CONSTRAINTS}`;
}

function coverPrompt(book) {
  return `${IDENTITY}
Subject: ${subjectFor(book)}
A book COVER photograph of this child. The scene should evoke the title "${clampField(book.title, LIMITS.title) || 'an adventure'}" — but include NO title text.
${styleFor(book)}
Portrait 3:4 composition; keep the top third calm and uncluttered (a title is typeset over it later).
${CONSTRAINTS}`;
}

// djb2 — tiny, stable, dependency-free.
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function artFingerprint(book) {
  const d = (book.data && typeof book.data === 'object') ? book.data : {};
  return JSON.stringify({
    audience: book.audience, direction: book.direction || 0,
    looks: d.looks || '', age: d.age || '', members: d.members || '',
    photo: book.photo ? hashStr(book.photo) : (Array.isArray(book.photos) ? book.photos.map(hashStr) : ''),
  });
}

module.exports = {
  STYLE_BLOCKS, CONSTRAINTS, IDENTITY, MOODS, LIMITS, clampField,
  platePrompt, coverPrompt, artFingerprint,
};
