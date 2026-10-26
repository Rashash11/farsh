// lib/pageCount.js
//
// How many story pages a book has, not counting the cover. This is the one
// number the story schema, the plate loop, the redraw clamp and the order
// validator all have to agree on. The static pages cannot import it (there
// is no build step), so Book Preview's sample story is kept at this length
// by hand and the front end otherwise reads `pages.length` from the book.
const PAGE_COUNT = 11;

module.exports = { PAGE_COUNT };
