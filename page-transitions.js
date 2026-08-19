// Farsh! page transitions: hand-drawn strokes that draw themselves closed.
//
// The site is a set of separate .dc.html documents (Landing -> Book Builder
// -> Book Preview -> Checkout), linked with plain <a href>, so every hop is
// a full browser navigation. This script gives that hop the same move as
// github.com/Animmaster/SVG-Page-transition — organic strokes that draw
// along their path (stroke-dashoffset) while inflating (stroke-width) to
// cover the screen, then thin back down and retreat to reveal the next
// page — rebuilt from scratch rather than imported: that repo is GSAP- and
// SPA-shaped (history.pushState, innerHTML swap, no license on the code),
// none of which fits real multi-document navigation, so this reimplements
// the same technique in plain CSS transitions over five of our own paths
// (the repo itself uses two; more here reads as a fuller hand-drawn wash
// rather than a couple of lines crossing). Duration and easing are pulled
// directly from the repo's own tween — 1s, power1.inOut-equivalent, both
// directions — since a first pass at this with a much shorter, bounced
// version read as two lines flicking past rather than ink filling the
// screen. A plain paper-colored html::before still sits underneath as the
// actual covering guarantee — the strokes are the show, not the safety
// net, since organic bands can leave slivers uncovered at odd viewport
// ratios.
//
// Earlier versions of this same hop, for the record: a plain opacity
// cross-fade, then a curtain with two straight ruled lines at its edge
// (read as sharp/mechanical, not warm), then a single static hand-drawn
// line baked into a CSS mask (closer, but not actually animated), then a
// first pass at real animated strokes kept fast (~300ms) and bounced on
// arrival on the theory that a real page-load gap needed extra brevity —
// that read as too little, too quick, so this is the version that both
// draws for real and takes its time doing it. Before any of those, a
// perspective/rotateY "page turn" tilt on the actual content read as text
// sliding/skewing and felt laggy across that same page-load gap — which is
// why every version since keeps the motion on <html>, never on page
// content, regardless of how long the motion itself now runs. It also
// stays a single sweep direction regardless of which way the user is
// navigating the site's flow — no forward/back metaphor to track.
//
// IMPORTANT: this deliberately never writes to .page-sheet's own style or
// class attributes. The dc-runtime (support.js) always does a redundant
// self-fetch(location.href) shortly after boot and re-renders from it,
// which unconditionally rewrites .page-sheet's inline `style` attribute
// back to its bare template value (confirmed via MutationObserver: this
// happens ~15ms after mount, on every load) — any transform/opacity set
// directly on that element gets clobbered mid-animation, which is what
// caused the earlier "broken"/snapping movement. Instead, the animation is
// driven by a class on <html> (which the dc-runtime never touches, since it
// only manages #dc-root inside <body>) plus a stylesheet rule injected into
// the real <head>. The paper-colored cover is a plain html::before
// pseudo-element — not a DOM node — so it needs nothing to exist and is
// covering from the very first paint. The stroke paths are real <svg>
// content, because animating them (drawing along a path, growing in
// width) needs each path's actual measured length, which only exists once
// there's a real element to call getTotalLength() on — so that piece
// mounts alongside .page-sheet, once <body> exists, still outside
// #dc-root and still never touched by the dc-runtime's re-render.
//
// Fully inert under prefers-reduced-motion: reduce — navigation stays
// exactly as instant as it is without this script.
//
// Include on every .dc.html page, right after support.js:
//   <script src="./page-transitions.js"></script>
// and mark that page's outer content wrapper (the div with the visible
// left/right "page edge" borders) with class="page-sheet".

(() => {
  "use strict";

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  // The reference repo's own tween (both leave and enter): duration 1s,
  // ease "power1.inOut", identical for both directions, no stagger between
  // paths. The earlier version of this file used a third of that with a
  // bounce, on the theory that a real page-load gap needed extra brevity —
  // in practice that just made the strokes read as two lines flicking past
  // rather than ink actually filling the screen, so this matches the
  // repo's own pacing much more closely instead: one duration, one smooth
  // ease, both directions, comfortably long enough to actually watch draw.
  const DURATION = 900; // ms
  const EASE = "cubic-bezier(0.45, 0, 0.55, 1)"; // power1.inOut-equivalent, no overshoot
  const COVER_CLASS = "pt-cover";
  const STROKE_MAX_WIDTH = 260; // viewBox units — trimmed a bit now there are more bands, so paper still shows through between them rather than the wash going fully solid

  // Five organic bands (the repo itself uses two; more here reads as a
  // fuller hand-drawn wash rather than a couple of lines crossing), each
  // drawn corner-to-corner past the visible viewBox on both ends (so a
  // round stroke-linecap never shows as a stray dot at the edge) and at a
  // distinct angle so they cross rather than stack on top of each other.
  // viewBox is 0..1000 square and stretched to the real viewport with
  // preserveAspectRatio="none", same trick the repo uses.
  //
  // The repo itself colors its two paths differently (--transition-stroke-1
  // vs -2) — each band here does too, rather than one flat accent repeated
  // five times. All five colors are real tokens this palette already
  // defines (three terracotta steps, --color-accent-400/500/700, plus the
  // olive family's --color-accent-2-700/900) — nothing invented for this.
  const STROKE_PATHS = [
    {
      d: "M -200,650 C 100,850 350,450 600,600 C 850,750 1050,500 1300,600",
      colorVar: "--color-accent",
      fallback: "#c67139",
    },
    {
      d: "M -200,250 C 150,80 400,380 650,220 C 900,60 1100,300 1300,180",
      colorVar: "--color-accent-2-700",
      fallback: "#3d4a29",
    },
    {
      d: "M 1300,-200 C 1050,150 700,80 520,380 C 340,680 -50,480 -300,720",
      colorVar: "--color-accent-700",
      fallback: "#8c491a",
    },
    {
      d: "M -300,-100 C 50,200 -100,500 250,650 C 600,800 550,1050 900,1200",
      colorVar: "--color-accent-400",
      fallback: "#e08b4f",
    },
    {
      d: "M -200,950 C 150,750 450,1050 750,850 C 1000,700 1150,900 1300,800",
      colorVar: "--color-accent-2-900",
      fallback: "#272e1b",
    },
  ];
  const SVG_NS = "http://www.w3.org/2000/svg";

  // --color-bg/--color-accent are redefined on :root by an inline <style>
  // the page itself carries (the site's real palette; the linked _ds/
  // stylesheet is reference material, not what's live), which this script's
  // own <style> can render before that inline block has necessarily run.
  // The literal fallback matches that live palette, so the paper cover is
  // still fully opaque — no flash of the page underneath — even on the
  // very first paint of a cold load.
  const style = document.createElement("style");
  style.textContent = `
    html::before {
      content: "";
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      pointer-events: none;
      background-color: var(--color-bg, #f5ead8);
      transform: translateX(-100%);
      transition: transform ${DURATION}ms ${EASE};
    }
    html.${COVER_CLASS}::before {
      transform: translateX(0);
    }
    .pt-strokes {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: 2147483647;
      pointer-events: none;
    }
    .pt-stroke {
      fill: none;
      /* stroke color is set per-path as an inline style in mountStrokes()
         below, since each band uses a different token — see STROKE_PATHS */
      stroke-linecap: round;
      stroke-width: 4;
      stroke-dasharray: var(--len);
      stroke-dashoffset: var(--len);
      transition: stroke-dashoffset ${DURATION}ms ${EASE},
                  stroke-width ${DURATION}ms ${EASE};
    }
    html.${COVER_CLASS} .pt-stroke {
      stroke-dashoffset: 0;
      stroke-width: ${STROKE_MAX_WIDTH};
    }
  `;
  document.head.appendChild(style);

  // Cover immediately, before .page-sheet even exists, so the incoming
  // page's very first paint is already hidden, ready to reveal. The
  // strokes join in once mounted below — until then this plain paper fill
  // alone is already doing the actual hiding.
  document.documentElement.classList.add(COVER_CLASS);

  // Real <svg>, mounted as a sibling of #dc-root directly on <body> — never
  // inside it, so the dc-runtime's re-render (which only manages #dc-root)
  // never touches it. Each path's dash length is measured once, right
  // after mounting, and stashed as a CSS custom property so the stylesheet
  // rules above can animate dashoffset from "whole path hidden" to "fully
  // drawn" without hardcoding a length that only this exact path data
  // produces.
  function mountStrokes() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "pt-strokes");
    svg.setAttribute("viewBox", "0 0 1000 1000");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    const paths = STROKE_PATHS.map(({ d, colorVar, fallback }) => {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", "pt-stroke");
      // Inline, not a shared class rule, since each band carries a
      // different token — still a real var() so it tracks the live
      // cascade rather than freezing today's hex value.
      path.style.stroke = `var(${colorVar}, ${fallback})`;
      svg.appendChild(path);
      return path;
    });
    document.body.appendChild(svg);
    for (const path of paths) {
      path.style.setProperty("--len", path.getTotalLength());
    }
  }

  function currentSheet() {
    return document.querySelector(".page-sheet");
  }

  function whenSheetMounted(cb) {
    const existing = currentSheet();
    if (existing) {
      cb(existing);
      return;
    }
    const observer = new MutationObserver(() => {
      const el = currentSheet();
      if (el) {
        observer.disconnect();
        cb(el);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  whenSheetMounted(() => {
    // .page-sheet existing means <body> exists, so the strokes can mount
    // now — before the double rAF below, so their measured --len is in
    // place and matching the (already-applied) covered-state rule the
    // instant they're inserted, same as html::before already does.
    mountStrokes();
    // Double rAF: let the browser paint the covered state before removing
    // the class, or the transition can get collapsed into a no-op.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.classList.remove(COVER_CLASS);
      });
    });
  });

  // Same-pathname links (in-page anchors like #books, placeholder "#"
  // links) should keep behaving like normal anchors — only intercept
  // actual navigations to a sibling .dc.html document.
  function eligibleDestination(link) {
    if (!link || !link.href) return null;
    let url;
    try {
      url = new URL(link.href, location.href);
    } catch {
      return null;
    }
    if (url.origin !== location.origin) return null;
    if (!/\.dc\.html$/i.test(url.pathname)) return null;
    if (link.target && link.target !== "_self") return null;
    if (link.hasAttribute("download")) return null;
    if (url.pathname === location.pathname && url.search === location.search) return null;
    if (url.href === location.href) return null;
    return url.href;
  }

  document.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const link = e.target instanceof Element ? e.target.closest("a[href]") : null;
      const dest = eligibleDestination(link);
      if (!dest) return;

      const sheet = currentSheet();
      if (!sheet) return; // not mounted yet — fall back to a plain navigation

      e.preventDefault();

      let navigated = false;
      const go = () => {
        if (navigated) return;
        navigated = true;
        location.href = dest;
      };

      document.documentElement.classList.add(COVER_CLASS);
      // The paper cover is html::before, not part of .page-sheet, so its
      // transitionend fires on <html> (pseudo-element events bubble to
      // their host element) — guard the property so an unrelated
      // transition on <html>, if one's ever added later, can't consume
      // this listener before the real one fires. The stroke paths also
      // transition, but they're real elements — their events bubble with
      // a different target and propertyName, so they fall through here
      // without needing a separate check.
      const onTransitionEnd = (te) => {
        if (te.target !== document.documentElement || te.propertyName !== "transform") return;
        document.documentElement.removeEventListener("transitionend", onTransitionEnd);
        go();
      };
      document.documentElement.addEventListener("transitionend", onTransitionEnd);
      // Safety net — a click can never get stuck even if transitionend
      // never fires (interrupted animation, display:none ancestor, etc).
      setTimeout(go, DURATION + 150);
    },
    true
  );

  // bfcache restores (Back/Forward) can resurrect a page mid-transition —
  // always land back fully visible.
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    document.documentElement.classList.remove(COVER_CLASS);
  });
})();
