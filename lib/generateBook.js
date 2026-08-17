// Calls Claude to write the 6 story pages for a book, personalized from what
// the user entered in Book Builder. Returns a plain array of 6 page-text
// strings — the chapter *headings* stay the fixed ones already baked into
// Book Preview.dc.html; only the paragraph text is generated here. Keeping
// the headings fixed means a bad or short generation can never break the
// page structure the frontend expects.

const Anthropic = require('@anthropic-ai/sdk');

// Mirrors the `chapter` labels in Book Preview.dc.html's spreads() — kept in
// sync by hand since the frontend is plain templated HTML, not a shared module.
const CHAPTER_BEATS = {
  child: [
    'Chapter one — the ordinary moment that turns strange',
    'Chapter two — meeting the other side of the door',
    'Chapter three — traveling further than expected, unafraid',
    'Chapter four — the trouble turns out smaller than it looked',
    'Chapter five — solving it and getting home in time',
    'The last page — the door is still there, checked every morning',
  ],
  couple: [
    'One — the reluctant beginning, told plainly',
    'Two — the ordinary hardship of the early days',
    'Three — distance, and learning to say the important things quickly',
    'Four — a quiet year with no story in it, which was the good kind',
    'Five — the private joke, printed here without explanation',
    'The last page — ordinary evenings ever since, and no better ending than that',
  ],
  family: [
    'How it starts — the table everyone gathers at',
    'The old house — a physical detail everyone in the family remembers',
    'A page each — everyone gets exactly one page, no more',
    'The summer — one specific trip or season that became "the story"',
    'The ones before — names, a place, a journey, told simply',
    'The last page — what the book is for, and who it is for',
  ],
};

const FIELD_LABELS = {
  child: { name: 'Name', age: 'Age', looks: 'What they look like', loves: 'What they love' },
  couple: { name: 'Their name', partner: "Partner's name", since: 'Together since', met: 'How they met' },
  family: { name: 'Family name', members: 'Who is in it', year: 'Year to remember', place: 'A place they all know' },
};

function buildPrompt(book) {
  const audience = ['child', 'couple', 'family'].includes(book.audience) ? book.audience : 'child';
  const beats = CHAPTER_BEATS[audience];
  const labels = FIELD_LABELS[audience];
  const data = book.data && typeof book.data === 'object' ? book.data : {};

  const details = Object.entries(labels)
    .map(([key, label]) => (data[key] ? `- ${label}: ${data[key]}` : null))
    .filter(Boolean)
    .join('\n') || '(no extra details given — invent something warm and specific rather than generic)';

  const woven = Array.isArray(book.tags) && book.tags.length ? book.tags.join(', ') : null;

  return `You are writing the text for a short personalized hardcover book sold by Farsh!, a company that makes made-to-order books for a child, a couple, or a family. Write exactly 6 short page texts for this book, one per beat listed below, in order.

Audience: ${audience === 'child' ? 'a young child (this book stars them as the hero)' : audience === 'couple' ? 'a couple, about their relationship' : 'a whole family'}
Names / subject: ${book.names || '(not given — use "you" or a warm generic address)'}
Title chosen: ${book.title || '(untitled)'}
${details}
${woven ? `Things to weave in naturally where they fit: ${woven}` : ''}
${book.dedication ? `Dedication (for tone/context only, don't repeat it verbatim in the pages): ${book.dedication}` : ''}

Page beats, in order — write one short paragraph (2-4 sentences) for each:
${beats.map((b, i) => `${i + 1}. ${b}`).join('\n')}

Style: warm, specific, a little wry — never generic or greeting-card. Use concrete, small, particular details rather than abstractions. Address the subject by name where natural. Do not use headings, numbering, or markdown in the page text itself — plain prose only, one paragraph per page.`;
}

const PAGES_SCHEMA = {
  type: 'object',
  properties: {
    pages: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['pages'],
  additionalProperties: false,
};

/**
 * @param {object} book - the object the frontend already stores in
 *   localStorage under "farsh.book" (audience, names, title, tags,
 *   dedication, direction, data).
 * @param {string|undefined} apiKey - explicit key from .env; when absent the
 *   SDK's default resolution is tried (ANTHROPIC_AUTH_TOKEN, `ant auth login`
 *   profile), so a logged-in machine works with an empty .env too.
 * @returns {Promise<string[]>} exactly 6 page-text strings
 */
async function generateBookPages(book, apiKey) {
  let client;
  try {
    client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  } catch (e) {
    // SDK throws synchronously when no credential source resolves.
    throw new Error('missing_api_key');
  }

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 2048,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: PAGES_SCHEMA },
    },
    messages: [{ role: 'user', content: buildPrompt(book) }],
  });

  if (response.stop_reason === 'refusal') {
    const category = response.stop_details && response.stop_details.category;
    throw new Error('generation_refused' + (category ? `:${category}` : ''));
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('no_text_in_response');

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (e) {
    throw new Error('invalid_json_response');
  }

  let pages = Array.isArray(parsed.pages) ? parsed.pages.filter((p) => typeof p === 'string' && p.trim()) : [];
  if (pages.length === 0) throw new Error('empty_pages');

  // Defensive normalize to exactly 6 — the schema can't enforce array length,
  // and the frontend's chapter/thumbnail rail assumes 6 pages.
  if (pages.length > 6) pages = pages.slice(0, 6);
  while (pages.length < 6) pages.push(pages[pages.length - 1]);

  return pages;
}

module.exports = { generateBookPages, buildPrompt, CHAPTER_BEATS };
