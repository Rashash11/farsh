const test = require('node:test');
const assert = require('node:assert');
const {
  STYLE_BLOCKS, CONSTRAINTS, IDENTITY, MOODS,
  platePrompt, coverPrompt, artFingerprint,
} = require('../lib/artPrompts');

const child = {
  audience: 'child', direction: 0, title: 'Nova and the door',
  data: { name: 'Nova', age: '7', looks: 'curly dark hair, round glasses' },
};

test('every audience/direction has a style block', () => {
  for (const aud of ['child', 'couple', 'family']) {
    for (const d of [0, 1, 2]) assert.ok(STYLE_BLOCKS[aud][d].length > 40, aud + d);
  }
});

test('the sheet prompts are gone', () => {
  const mod = require('../lib/artPrompts');
  assert.strictEqual(mod.characterSheetPrompt, undefined);
  assert.strictEqual(mod.photoSheetPrompt, undefined);
});

test('child styles are photorealistic, never painted', () => {
  for (const d of [0, 1, 2]) {
    assert.match(STYLE_BLOCKS.child[d], /photoreal/i);
    assert.doesNotMatch(STYLE_BLOCKS.child[d], /gouache|painted|brushwork/i);
  }
  assert.match(CONSTRAINTS, /photoreal/i);
  assert.doesNotMatch(CONSTRAINTS, /never photorealistic/i);
  assert.match(CONSTRAINTS, /no text/i);
  assert.match(CONSTRAINTS, /cartoon|anime/i);
});

test('cover and plate prompts carry the identity block and end with the constraints', () => {
  for (const p of [platePrompt(child, 'the child opens a green door'), coverPrompt(child)]) {
    assert.ok(p.includes(IDENTITY), 'identity block missing');
    assert.ok(p.trim().endsWith(CONSTRAINTS), p.slice(-120));
    assert.match(p, /attached photograph/i);
  }
  assert.match(IDENTITY, /never age/i);
  assert.match(IDENTITY, /identity wins|identity must win/i);
});

test('plate prompt is square and leaves room for text; cover is portrait with calm top third', () => {
  assert.match(platePrompt(child, 'a'), /1:1/);
  assert.match(platePrompt(child, 'a'), /negative space|room for text/i);
  assert.match(coverPrompt(child), /3:4/);
  assert.match(coverPrompt(child), /top third/i);
});

test('prompts include looks and age, never the name', () => {
  const p = platePrompt(child, 'the child climbs a wall');
  assert.match(p, /curly dark hair/);
  assert.match(p, /7-year-old/);
  assert.ok(!p.includes('Nova'));
});

test('every user field that reaches the image model is bounded', () => {
  const big = 'x'.repeat(5000);
  const book = { ...child, title: big, data: { name: 'N', age: big, looks: big } };
  const plate = platePrompt(book, big);
  const cover = coverPrompt(book);
  assert.ok(plate.length < 2500, 'plate prompt is ' + plate.length);
  assert.ok(cover.length < 2500, 'cover prompt is ' + cover.length);
  assert.ok(!plate.includes('Scene: ' + 'x'.repeat(400)), 'scene not clamped');
});

test('MOODS lists three child directions', () => {
  assert.deepStrictEqual(MOODS.map((m) => m.key), ['golden', 'moonlit', 'kingdom']);
});

test('artFingerprint ignores name, changes with looks/direction/photo', () => {
  const fp = artFingerprint(child);
  assert.strictEqual(fp, artFingerprint({ ...child, data: { ...child.data, name: 'Zeus' } }));
  assert.notStrictEqual(fp, artFingerprint({ ...child, direction: 1 }));
  assert.notStrictEqual(fp, artFingerprint({ ...child, data: { ...child.data, looks: 'red hair' } }));
  assert.notStrictEqual(fp, artFingerprint({ ...child, photo: 'data:image/jpeg;base64,AAAA' }));
});

test('a numeric age still renders as N-year-old', () => {
  const p = platePrompt({ ...child, data: { ...child.data, age: 7 } }, 'a');
  assert.match(p, /7-year-old/);
});

test('a scene ending in a full stop or ellipsis gets no doubled punctuation', () => {
  assert.doesNotMatch(platePrompt(child, 'the child waves.'), /\.\./);
  assert.doesNotMatch(platePrompt(child, 'x'.repeat(5000)), /…\./);
});
