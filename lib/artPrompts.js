// Pure prompt builders for book illustrations. No network, no state —
// everything here is snapshot-testable. Style blocks are versioned by
// being literal strings: change one and the artFingerprint stays the
// same on purpose (style tweaks should not invalidate every cached book).

const CONSTRAINTS =
  'Painted storybook illustration only — never photorealistic. No text, ' +
  'letters, numbers, borders, or watermarks in the image. Single coherent scene.';

const BASE_MEDIUM =
  'painted storybook illustration, gouache and colored-pencil texture, ' +
  'visible brushwork, classic 1970s Scholastic paperback feel';

const STYLE_BLOCKS = {
  child: {
    0: `Midnight Magic style: ${BASE_MEDIUM}, ink-dark night palette with deep blues, glowing warm lantern light, twinkling stars, dreamlike and quiet.`,
    1: `Scrapbook style: ${BASE_MEDIUM}, cut-paper and tape collage accents, handmade craft feel, warm kraft-paper tones with bright sticker colors.`,
    2: `Toybox style: ${BASE_MEDIUM}, loud saturated primary colors, round friendly shapes, everything in joyful motion.`,
  },
  couple: {
    0: `Midnight Velvet style: ${BASE_MEDIUM}, deep quiet palette of wine and midnight blue, intimate low light, very few elements per scene.`,
    1: `Letter Press style: ${BASE_MEDIUM}, vintage letterpress texture on thick cream paper, muted inks, classical and nostalgic.`,
    2: `Paper Garden style: ${BASE_MEDIUM}, botanical margins, soft floral colors, lots of white space, delicate organic shapes.`,
  },
  family: {
    0: `Kitchen Table style: ${BASE_MEDIUM}, warm domestic light, handwriting-adjacent looseness, everyone mid-conversation.`,
    1: `The Album style: ${BASE_MEDIUM}, composed like mounted photographs with painted captions-space, sepia-warmed colors.`,
    2: `Long Table style: ${BASE_MEDIUM}, wide tableaus like places set for dinner, earthy welcoming palette.`,
  },
};

function styleFor(book) {
  const aud = ['child', 'couple', 'family'].includes(book.audience) ? book.audience : 'child';
  const dir = [0, 1, 2].includes(book.direction) ? book.direction : 0;
  return STYLE_BLOCKS[aud][dir];
}

function subjectFor(book) {
  const d = (book.data && typeof book.data === 'object') ? book.data : {};
  if (book.audience === 'couple') {
    return `two adults, a couple${d.met ? ` (how they met: ${d.met})` : ''}. Warm, understated, never saccharine.`;
  }
  if (book.audience === 'family') {
    return `a family${d.members ? `: ${d.members}` : ''}. Group scenes, everyone distinct and consistent.`;
  }
  const age = d.age ? `${d.age}-year-old` : 'young';
  const looks = d.looks ? `, ${d.looks}` : '';
  return `a ${age} child${looks}. Cheerful, expressive face. Simple timeless clothes.`;
}

function characterSheetPrompt(book) {
  return `Character reference sheet, ${styleFor(book)}
Character(s): ${subjectFor(book)}
Show the SAME character(s) 4 times on one sheet: front view, side view, mid-action pose, expressive close-up. Plain cream background.
${CONSTRAINTS}`;
}

function photoSheetPrompt(book) {
  const intro = book.audience === 'couple'
    ? 'Transform the people in the attached photo into painted storybook characters: preserve each person\'s hair style and color, skin tone, and glasses if present. Fully illustrated with gouache texture — not a photo filter. Show the SAME two characters together in each of the 4 poses.'
    : 'Transform the person in the attached photo into a painted storybook character: preserve hair style and color, skin tone, and glasses if present. Fully illustrated with gouache texture — not a photo filter.';
  return `${intro}
${styleFor(book)}
Same 4-pose reference sheet layout: front view, side view, mid-action pose, expressive close-up. Plain cream background.
${CONSTRAINTS}`;
}

function platePrompt(book, scene) {
  return `Using the attached character reference sheet, illustrate this exact character (same face, hair, glasses, clothes) in a new scene.
Scene: ${scene || 'a quiet, warm moment from the story'}.
${styleFor(book)}
Landscape 4:3 composition.
${CONSTRAINTS}`;
}

function coverPrompt(book) {
  return `Using the attached character reference sheet, paint a book COVER illustration of this exact character.
The scene should evoke the book's title: "${book.title || 'an adventure'}" — but paint NO title text.
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
  STYLE_BLOCKS, CONSTRAINTS,
  characterSheetPrompt, photoSheetPrompt, platePrompt, coverPrompt,
  artFingerprint,
};
