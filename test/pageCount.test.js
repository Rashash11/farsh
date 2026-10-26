// test/pageCount.test.js
const test = require('node:test');
const assert = require('node:assert');

test('a book has eleven story pages after the cover', () => {
  const { PAGE_COUNT } = require('../lib/pageCount');
  assert.strictEqual(PAGE_COUNT, 11);
});
