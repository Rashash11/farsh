// Which books Farsh! actually sells right now.
//
// The site, the prompts and the order validator all know about three
// audiences (child, couple, family), and the couple/family code paths are
// kept intact in lib so they can come back with a one-line change here. But
// for now only the child book is sold, so every entry point — the order
// validator, the text route, the art routes, and the pages — must agree on
// this single list rather than each carrying its own hard-coded trio. A
// request for a couple or family book, however complete, is refused; an
// order we cannot fulfil must never be emailed as if it were one.
const ALLOWED_AUDIENCES = ['child'];

function isAllowedAudience(audience) {
  return ALLOWED_AUDIENCES.indexOf(audience) > -1;
}

module.exports = { ALLOWED_AUDIENCES, isAllowedAudience };
