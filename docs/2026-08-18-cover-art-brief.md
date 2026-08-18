# Cover art brief — Landing Page child gallery

Reference: the "The Littles" (John Peterson, Scholastic) paperback cover —
painted, character-driven children's-book illustration. Replaces the
current flat-geometric, faceless scene illustrations for the 9 covers in
the "For a child" gallery on `Landing Page.dc.html`.

## Why

The current covers (`uploads/covers/*.jpg`) are flat vector-style scenes
with no characters — a door, a cave, a cake — nothing that reads as an
actual book a kid is the hero of. The product's whole pitch is "books
with your people in them"; the sample covers should look like real,
warm, painted storybook covers with a child as the visible hero.

## Technical spec (applies to all 9)

- **Aspect ratio**: 3:4 portrait, matching the current files (640×854).
  Generate at 1280×1708 (2×) or higher for retina/print reuse, then
  downscale.
- **Format**: JPEG, same filenames as today so no code changes are
  needed — just replace the files in `uploads/covers/`.
- **No text, no title lockup, no logo** on the image itself. The site
  overlays the title/meta separately below the card, and reveals a
  "page one" text snippet *underneath* the cover on hover (the cover
  art hinges open like a door) — the illustration must be a clean,
  full-bleed scene with nothing baked in that would conflict with that.
- **Full-bleed**: the image fills the whole 3:4 card, no border/frame/
  vignette baked into the file itself (the card's own 2px border is
  applied by CSS, not the image).

## House style (consistent across all 9)

- **Medium**: painted illustration — gouache/watercolor and colored-
  pencil texture, visible brushwork. Not flat vector shapes, not 3D
  render, not photorealistic.
- **Era/reference**: 1970s–80s Scholastic paperback illustration style
  (see "The Littles" reference) — warm, slightly soft edges, expressive
  faces, real character presence.
- **Character**: each cover features one *generic* child character (not
  a specific race/gender unless the scene calls for it — keep it
  broadly relatable, since this is a sample cover before any real
  buyer personalizes their own book). Expressive face, caught mid-
  action or mid-emotion relevant to that book's premise — never a
  static posed portrait.
- **Palette**: keep it in the site's existing warm family so the grid
  still reads as one set next to the couple/family cards — terracotta,
  moss green, warm cream, deep brown, with the child's clothing/accents
  allowed a brighter accent color for warmth and variety between
  covers.
- **Lighting**: warm, golden, storybook lighting — not flat/even.

## Per-cover prompts

Each entry: filename → title → the existing landing-page blurb (for
tone) → the scene to paint.

1. **great-adventure.jpg** — *The Great Adventure* — "The morning
   [name] found a door in the garden wall." → A child mid-step through
   a small arched green door set into a tall brick garden wall,
   glancing back over their shoulder with a delighted, mischievous grin,
   morning light spilling through the doorway.

2. **goodnight-little-one.jpg** — *Goodnight, Little One* — "Ten small
   sleepy things happen before [name] closes their eyes." → A drowsy
   toddler mid-yawn, tucked in bed with one stuffed animal, moonlight
   through a window, soft blues and warm lamp-light.

3. **dragons-cave-quest.jpg** — *Dragon's Cave Quest* — "[name] packs a
   torch, a sandwich and no fear at all." → A child standing at a cave
   mouth in a green hillside, torch raised high, backpack half-open
   with a sandwich poking out, brave/determined expression, a hint of
   dragon eye-glow deep in the cave shadow.

4. **birthday-wish.jpg** — *Birthday Wish* — "[name] makes a wish far
   too big for one cake." → A child leaning over a tall birthday cake,
   cheeks puffed to blow out candles, eyes scrunched shut making a big
   wish, candlelight lighting their face from below.

5. **under-the-sea.jpg** — *Under the Sea* — "[name] learns to breathe
   underwater on an ordinary Tuesday." → A child underwater in
   everyday clothes (not a diving suit — the joke is how ordinary it
   is), hair floating, laughing in surprise, a curious fish nearby,
   dappled sunlight from the surface above.

6. **the-night-you-arrived.jpg** — *The Night You Arrived* — "Everything
   that happened on the night [name] came home." → A cozy nursery
   window scene at night, a family silhouette welcoming a swaddled
   newborn home, warm porch light, stars outside.

7. **hello-from-me.jpg** — *Hello From Me* — "[name] has a job now:
   showing someone the whole world." → An older sibling crouched down
   proudly introducing a new baby to a favorite toy or pet, warm
   living-room light, big-sibling pride on their face.

8. **first-day-big-day.jpg** — *First Day, Big Day* — "New shoes, new
   door, new names to learn. [name] is ready." → A child standing tall
   in front of a school door in brand-new shoes, backpack on,
   determined/nervous-excited expression, morning light.

9. **brave-in-a-big-school.jpg** — *Brave in a Big School* — "[name]
   finds the one friend who makes a big place small." → Two kids
   sitting together on a school bench or hallway floor, mid
   laugh/conversation, big school architecture looming friendlier in
   the background rather than intimidating.

## Rollout

1. Generate all 9 to spec above (same filenames, drop into
   `uploads/covers/`, replacing the current files).
2. No code changes needed — `Landing Page.dc.html` already references
   these exact filenames.
3. Sanity check in the browser: the hover-open "hinge" interaction and
   the "page one" text reveal underneath should still read fine against
   the new art (nothing in the new spec conflicts with that, but worth
   an eyeball check once real files are in).

## Possible follow-on (not in scope here)

The three "Read a real page" plate images (`waking-up.jpg`,
`meeting-favorite.jpg`, `saving-the-day.jpg`, also reused in Book
Preview) are in the same old flat style and sit right next to this
gallery. Same house style would apply, but those three need to show
**the same child character across all three** for narrative continuity
(they're sequential pages of one story), which the 9 standalone covers
above don't need. Worth a separate pass once the cover style is
confirmed.
