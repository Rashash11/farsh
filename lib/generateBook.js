// Calls Claude to write the 6 story pages for a book, personalized from what
// the user entered in Book Builder. Returns a plain array of 6 page-text
// strings — the chapter *headings* stay the fixed ones already baked into
// Book Preview.dc.html; only the paragraph text is generated here. Keeping
// the headings fixed means a bad or short generation can never break the
// page structure the frontend expects.

// Calls Claude to write the PAGE_COUNT story pages for a book, personalized
// from what the parent entered in Book Builder. Returns PAGE_COUNT page
// texts and PAGE_COUNT one-line scene briefs. Page headings are not
// generated: the frontend numbers the pages, so a weak generation can never
// break the page structure the Preview expects.

const Anthropic = require('@anthropic-ai/sdk');
const { PAGE_COUNT } = require('./pageCount');

// Mirrors the `chapter` labels in Book Preview.dc.html's spreads() — kept in
// sync by hand since the frontend is plain templated HTML, not a shared module.
const CHAPTER_BEATS = {
  child: [
    'A wish — an ordinary morning, and something the child longs to see or do',
    'Setting out — exploring somewhere new, hands-on and curious',
    'A small creature in trouble — the child stops, kneels, and helps',
    'The journey — travelling further than expected, unafraid',
    'A discovery — a clue, a map, a story, or a door that points onward',
    'Something large — meeting a creature or a place that looks frightening and is not',
    'Staying brave — the hard moment, and choosing to stay and help anyway',
    'Helping the community — working alongside others to put something right',
    'A gift — giving something away to someone who needs it more',
    'Recognition — someone the child loves sees what they did, and says so',
    'The last page — home, looking out, knowing more adventures are coming',
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

// Every field below is user input that lands in a paid model call, so each one
// is bounded. Without this a single 256kb request body (the app-wide limit)
// becomes a ~60k-token prompt instead of the ~500 a real book needs — the rate
// limiter caps how MANY requests arrive, not how expensive each one is.
const LIMITS = { names: 120, title: 200, dedication: 500, field: 300, tag: 60, tags: 12 };

function clamp(value, max) {
  if (typeof value !== 'string') return '';
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() + '…' : flat;
}

function buildPrompt(book) {
  const audience = ['child', 'couple', 'family'].includes(book.audience) ? book.audience : 'child';
  const beats = CHAPTER_BEATS[audience];
  const labels = FIELD_LABELS[audience];
  const data = book.data && typeof book.data === 'object' ? book.data : {};

  const details = Object.entries(labels)
    .map(([key, label]) => {
      const v = clamp(data[key], LIMITS.field);
      return v ? `- ${label}: ${v}` : null;
    })
    .filter(Boolean)
    .join('\n') || '(no extra details given — invent something warm and specific rather than generic)';

  const tags = Array.isArray(book.tags)
    ? book.tags.slice(0, LIMITS.tags).map((t) => clamp(t, LIMITS.tag)).filter(Boolean)
    : [];
  const woven = tags.length ? tags.join(', ') : null;
  const names = clamp(book.names, LIMITS.names);
  const title = clamp(book.title, LIMITS.title);
  const dedication = clamp(book.dedication, LIMITS.dedication);

  return `You are writing the text for a personalized hardcover children's picture book sold by Farsh!, a company that makes made-to-order children's books. Write exactly ${PAGE_COUNT} page texts for this book, one per beat listed below, in order.

Audience: a young child (this book stars them as the hero)
Names / subject: ${names || '(not given — use "you" or a warm generic address)'}
Title: ${title || '(untitled)'}
Details:
${details}
${woven ? `Things to weave in naturally: ${woven}` : ''}
${dedication ? `Dedication (do not repeat it in the pages): ${dedication}` : ''}

Beats, one page each:
${beats.map((b, i) => `${i + 1}. ${b}`).join('\n')}

Rules for the text:
- 50–90 words per page. Short sentences. Natural, warm English a parent reads aloud.
- The child is doing something on every page: exploring, helping, riding, climbing, deciding. Never a page that only describes how they look.
- The backbone is kindness, courage and helping others; the last page looks forward.
- Use the child's name and details given above. Never invent a different name.
- No violence, no real danger, no frightening endings. Anything scary turns out gentle.

Rules for the scene briefs:
- One line per page, written for a photographer, not a painter: where the child is, what they are doing, time of day, light (morning sun, golden hour, candlelight, moonlight).
- Do not repeat the name in the scene line (say "the child").
- One single moment per scene, never two.

Return JSON: { "pages": [ { "text": "...", "scene": "..." }, ... ] } with exactly ${PAGE_COUNT} entries.`;
}

const PAGES_SCHEMA = {
  type: 'object',
  properties: {
    pages: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, scene: { type: 'string' } },
        required: ['text', 'scene'],
        additionalProperties: false,
      },
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
 * @param {object} [deps] - { client } to inject a messages client in tests
 * @returns {Promise<{pages: string[], scenes: string[]}>} exactly PAGE_COUNT
 *   page-text strings and their matching one-line illustration scene briefs.
 */
async function generateBookPages(book, apiKey, deps = {}) {
  let client = deps.client;
  if (!client) {
    try {
      client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
    } catch (e) {
      // SDK throws synchronously when no credential source resolves.
      throw new Error('missing_api_key');
    }
  }

  const response = await client.messages.create({
    model: 'claude-opus-5',
    // Eleven pages × up to 90 words, plus a scene line each, plus JSON
    // punctuation is well over the old 2048. A truncated JSON here fails to
    // parse and silently becomes the sample story, so the budget is generous.
    max_tokens: 6000,
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

  return normalizePages(parsed);
}

// Normalize to exactly PAGE_COUNT pages/scenes — the schema can't enforce
// array length. Extra pages are dropped. A SHORT story throws rather than
// being padded by repeating the last page: with eleven pages, padding would
// print two copies of the ending, and the route already knows how to fall
// back to the sample story on any failure.
// Also tolerates legacy plain-string page entries (pre-scene responses).
function normalizePages(parsed) {
  let items = Array.isArray(parsed.pages) ? parsed.pages : [];
  items = items
    .map((p) => (typeof p === 'string' ? { text: p, scene: '' } : p))
    .filter((p) => p && typeof p.text === 'string' && p.text.trim());
  if (items.length === 0) throw new Error('empty_pages');
  if (items.length < PAGE_COUNT) throw new Error(`generation_short:${items.length}`);
  items = items.slice(0, PAGE_COUNT);
  return {
    pages: items.map((p) => p.text),
    scenes: items.map((p) => (typeof p.scene === 'string' ? p.scene : '')),
  };
}

module.exports = { generateBookPages, buildPrompt, normalizePages, CHAPTER_BEATS, LIMITS };
