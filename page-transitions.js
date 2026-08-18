// Farsh! page-turn transitions.
//
// The site is a set of separate .dc.html documents (Landing -> Book Builder
// -> Book Preview -> Checkout), linked with plain <a href>, so every hop is
// a full browser navigation. This script gives that hop the same "page
// turning" feel the site already uses in-page (see each page's own
// `turnPage` keyframe): the outgoing page tips away, the incoming page
// settles in, using the same perspective/rotateY/easing numbers already in
// use elsewhere in this codebase.
//
// IMPORTANT: this deliberately never writes to .page-sheet's own style or
// class attributes. The dc-runtime (support.js) always does a redundant
// self-fetch(location.href) shortly after boot and re-renders from it,
// which unconditionally rewrites .page-sheet's inline `style` attribute
// back to its bare template value (confirmed via MutationObserver: this
// happens ~15ms after mount, on every load) — any transform/opacity set
// directly on that element gets clobbered mid-animation, which is what
// caused the "broken"/snapping movement. Instead, the animation is driven
// by a class on <html> (which the dc-runtime never touches, since it only
// manages #dc-root inside <body>) plus a stylesheet rule injected into the
// real <head>. Both are outside the runtime's re-render entirely.
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

  const EASE = "cubic-bezier(.16,1,.3,1)";
  const DURATION = 550; // ms — matches the site's existing turnPage keyframes
  const TURNED_CLASS = "pt-turned";

  const style = document.createElement("style");
  style.textContent =
    ".page-sheet{transition:transform " + DURATION + "ms " + EASE + ",opacity " + DURATION + "ms " + EASE + ";transform-origin:left center}" +
    "html." + TURNED_CLASS + " .page-sheet{transform:perspective(1400px) rotateY(-20deg);opacity:.15}";
  document.head.appendChild(style);

  // Pose immediately, before .page-sheet even exists, so the incoming
  // page's very first paint already shows the "turned" pose.
  document.documentElement.classList.add(TURNED_CLASS);

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
    // Double rAF: let the browser paint the "turned" pose before removing
    // the class, or the transition can get collapsed into a no-op.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.classList.remove(TURNED_CLASS);
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

      document.documentElement.classList.add(TURNED_CLASS);
      sheet.addEventListener("transitionend", go, { once: true });
      // Safety net — a click can never get stuck even if transitionend
      // never fires (interrupted animation, display:none ancestor, etc).
      setTimeout(go, DURATION + 150);
    },
    true
  );

  // bfcache restores (Back/Forward) can resurrect a page mid-turn — always
  // land back in the fully-settled state.
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    document.documentElement.classList.remove(TURNED_CLASS);
  });
})();
