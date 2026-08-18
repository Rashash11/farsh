const test = require('node:test');
const assert = require('node:assert');
const { buildPrompt, normalizePages } = require('../lib/generateBook');

test('buildPrompt asks for a scene per page', () => {
  const p = buildPrompt({ audience: 'child', names: 'Nova', data: { name: 'Nova' } });
  assert.match(p, /scene/i);
  assert.match(p, /"scene"/); // the JSON field name is spelled out
});

test('normalizePages splits objects into pages and scenes, padded to 6', () => {
  const parsed = { pages: [
    { text: 'One.', scene: 'a door' },
    { text: 'Two.', scene: 'a dragon' },
  ] };
  const { pages, scenes } = normalizePages(parsed);
  assert.strictEqual(pages.length, 6);
  assert.strictEqual(scenes.length, 6);
  assert.strictEqual(pages[0], 'One.');
  assert.strictEqual(scenes[1], 'a dragon');
  assert.strictEqual(pages[5], 'Two.'); // padded by repeating last
});

test('normalizePages tolerates legacy plain-string pages', () => {
  const { pages, scenes } = normalizePages({ pages: ['A.', 'B.'] });
  assert.strictEqual(pages[0], 'A.');
  assert.strictEqual(scenes[0], ''); // no scene available
});
