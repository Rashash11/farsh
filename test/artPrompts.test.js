const test = require('node:test');
const assert = require('node:assert');
const {
  STYLE_BLOCKS, CONSTRAINTS,
  characterSheetPrompt, photoSheetPrompt, platePrompt, coverPrompt,
  artFingerprint,
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

test('all prompts end with the constraints block', () => {
  for (const p of [characterSheetPrompt(child), photoSheetPrompt(child),
                   platePrompt(child, 'the child opens a green door'), coverPrompt(child)]) {
    assert.ok(p.trim().endsWith(CONSTRAINTS), p.slice(-120));
  }
});

test('character sheet includes looks and age, never the name', () => {
  const p = characterSheetPrompt(child);
  assert.match(p, /curly dark hair/);
  assert.match(p, /7-year-old/);
  assert.ok(!p.includes('Nova')); // names are typeset, not painted
});

test('plate prompt includes the scene and reference-sheet instruction', () => {
  const p = platePrompt(child, 'the child opens a green door');
  assert.match(p, /green door/);
  assert.match(p, /reference sheet/i);
  assert.match(p, /4:3/);
});

test('cover prompt is portrait with calm top third', () => {
  const p = coverPrompt(child);
  assert.match(p, /3:4/);
  assert.match(p, /top third/i);
});

test('photoSheetPrompt for a couple mentions both/two people and still ends with CONSTRAINTS', () => {
  const couple = { audience: 'couple', direction: 0, data: { met: 'at a bus stop' } };
  const p = photoSheetPrompt(couple);
  assert.match(p, /\btwo\b/i);
  assert.match(p, /people|characters/i);
  assert.ok(p.trim().endsWith(CONSTRAINTS), p.slice(-120));
});

test('artFingerprint ignores name, changes with looks/direction/photo', () => {
  const fp = artFingerprint(child);
  assert.strictEqual(fp, artFingerprint({ ...child, data: { ...child.data, name: 'Zeus' } }));
  assert.notStrictEqual(fp, artFingerprint({ ...child, direction: 1 }));
  assert.notStrictEqual(fp, artFingerprint({ ...child, data: { ...child.data, looks: 'red hair' } }));
  assert.notStrictEqual(fp, artFingerprint({ ...child, photo: 'data:image/jpeg;base64,AAAA' }));
});
