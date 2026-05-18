// icons.jsx — ISO 780:2015 / ISO 7000 package handling pictograms.
//
// ─── Sourcing ─────────────────────────────────────────────────────────────
// The 7 built-in icons are split between OFFICIAL artwork (6) and one
// APPROXIMATION (1):
//
//   key                  ISO 7000   Source                          License
//   ─────────────────────────────────────────────────────────────────────────
//   fragile              0621       Wikimedia Commons               CC0 1.0
//   this_way_up          0623       Wikimedia Commons               CC0 1.0
//   keep_dry             0626       Wikimedia Commons               CC0 1.0
//   centre_of_gravity    0627       Wikimedia Commons               CC0 1.0
//   stack_limit          0630       Wikimedia Commons               CC0 1.0
//   temp_limits          0632       Wikimedia Commons               CC0 1.0
//   no_stack             2402       Approximation (no free SVG)     —
//
// Wikimedia source URLs:
//   https://commons.wikimedia.org/wiki/File:ISO_7000_-_Ref-No_0621.svg
//   https://commons.wikimedia.org/wiki/File:ISO_7000_-_Ref-No_0623.svg
//   https://commons.wikimedia.org/wiki/File:ISO_7000_-_Ref-No_0626.svg
//   https://commons.wikimedia.org/wiki/File:ISO_7000_-_Ref-No_0627.svg
//   https://commons.wikimedia.org/wiki/File:ISO_7000_-_Ref-No_0630.svg
//   https://commons.wikimedia.org/wiki/File:ISO_7000_-_Ref-No_0632.svg
//
// Cleanup pipeline applied to each downloaded SVG:
//   1. Stripped the gray (#999) bracket-corner SIZE GUIDES that the
//      Wikimedia uploads include (those are not part of the symbol).
//   2. Replaced explicit `#000` / `#000000` / `black` with `currentColor`
//      so the symbol picks up the CSS color (and the "B&W filter" works
//      generically). Both attribute and inline-style declarations are
//      handled.
//   3. Added `viewBox="0 0 200 200"` to the three SVGs that originally
//      relied on `width`/`height` attributes only (the cleaner stripped
//      width/height in favour of viewBox-only sizing).
//   4. Kept all internal `<g transform="…">` nodes intact — the live
//      preview honours them natively, and `drawSvgToPdf` in app.jsx
//      threads a current-transformation-matrix through its walker so the
//      vector PDF export reproduces them faithfully.
//
// 2402 "Do Not Stack" and 2403 "Stacking Limit by Number" do not have free
// SVG releases on Wikimedia (verified via the MediaWiki API). We ship a
// stroke-based approximation for "no_stack" that follows the standard's
// "two stacked boxes with a forbidden cross" composition, and we use the
// officially-available 0630 "Stacking Limit by Mass" in place of 2403.
//
// ─── Size metadata ────────────────────────────────────────────────────────
// ISO 780:2015 §3.4 is the only sizing clause in the standard. It specifies
// the same three "normal" sizes (100 / 150 / 200 mm) for every symbol, with
// smaller sizes permitted "provided the visibility of the graphical symbols
// is retained". ASTM D5445, JIS Z 0150 and EN ISO 780 are direct adoptions.
// The 19 mm "soft minimum" is industry rule-of-thumb (not standard text).
//
// Each icon's metadata:
//   - iso:          reference for the panel tooltip
//   - isoNormalMm:  the standard's "normal" size (100 for most; 150 for
//                   Centre of Gravity, which Table 1 classes as a
//                   large-package symbol)
//   - safeMinMm:    industry rule-of-thumb minimum below which the UI
//                   surfaces a non-blocking visibility warning
//   - defaultMm:    sensible default for a typical 130×90 mm carton label
//   - svgString:    inline SVG markup (official artwork or our approximation)

// Stroke-based icon helper for the approximation entries — matches the
// Data Sheet creator's icon style so uploaded SVGs look at home.
const I = (children) => (
  <svg viewBox="0 0 32 32" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const ICON_LIBRARY = {
  // ── ISO 7000-0623  This Way Up (official, CC0) ────────────────────
  this_way_up: {
    label: "This Way Up",
    iso: "ISO 7000-0623",
    isoNormalMm: 100, safeMinMm: 19, defaultMm: 14,
    official: true,
    svgString: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 53.710415 53.710415"><g transform="translate(-22.358002,-114.24561)"><path style="fill:currentColor;stroke-width:0.421337" d="m 40.443721,118.90217 -6.049243,10.6903 h 4.617289 v 28.58637 h 2.864942 v -28.58637 h 4.616772 z m 17.538981,0 -6.049243,10.6903 h 4.617289 v 28.58637 h 2.864942 v -28.58637 h 4.616774 z M 33.683927,160.434 v 2.86546 H 64.742494 V 160.434 Z"/></g></svg>',
  },

  // ── ISO 7000-0621  Fragile / Handle With Care (official, CC0) ─────
  // ISO 780 classes this single symbol as both "Fragile" and "Handle With
  // Care" — they are not separate registered icons. We list it once.
  fragile: {
    label: "Fragile / Handle With Care",
    iso: "ISO 7000-0621",
    isoNormalMm: 100, safeMinMm: 19, defaultMm: 14,
    official: true,
    svgString: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><path fill="currentColor" d="m63.559 184.96v-6.3559l31.144-3.2688-0.0023-72.983c-7.355-1.1279-14.158-4.5733-19.42-9.8349-6.5558-6.5558-10.239-15.447-10.239-24.719l-1e-6 -52.754h69.915v52.754c0 9.2713-3.683 18.163-10.239 24.719-5.2617 5.2617-12.065 8.7071-19.42 9.8349l-2e-3 72.983 31.144 3.2688v6.3559h-72.881z"/></svg>',
  },

  // ── ISO 7000-0626  Keep Away From Rain / Keep Dry (official, CC0) ─
  keep_dry: {
    label: "Keep Dry (Keep Away From Rain)",
    iso: "ISO 7000-0626",
    isoNormalMm: 100, safeMinMm: 19, defaultMm: 14,
    official: true,
    svgString: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><path fill="currentColor" d="m100 60.225a82.696 82.696 0 0 0-74.346 46.881l9.0273 0.99805a16.594 16.594 0 0 1 13.041-6.3535 16.594 16.594 0 0 1 13.068 6.4004 16.594 16.594 0 0 1 13.07-6.4004 16.594 16.594 0 0 1 13.068 6.4023 16.594 16.594 0 0 1 13.07-6.4023 16.594 16.594 0 0 1 13.07 6.4023 16.594 16.594 0 0 1 13.068-6.4023 16.594 16.594 0 0 1 13.07 6.4004 16.594 16.594 0 0 1 13.068-6.4004 16.594 16.594 0 0 1 13.041 6.3535l9.1934-1.0156a82.696 82.696 0 0 0-74.512-46.863z"/><path fill="currentColor" d="m82.555 38.496-0.28094 10.43c-0.07871 2.9224-2.179 5.4794-4.9812 6.0644-2.8022 0.58492-5.4972-0.97104-6.3917-3.6903-0.89446-2.7192 0.26982-5.8167 2.7613-7.346z"/><path fill="currentColor" d="m117.43 32.77-0.28094 10.43c-0.0787 2.9224-2.179 5.4794-4.9812 6.0644-2.8022 0.58492-5.4972-0.97104-6.3917-3.6903-0.89446-2.7192 0.26982-5.8167 2.7613-7.346z"/><path fill="currentColor" d="m140.87 44.898-0.28094 10.43c-0.0787 2.9224-2.179 5.4794-4.9812 6.0644-2.8022 0.58492-5.4972-0.97104-6.3917-3.6903-0.89446-2.7192 0.26982-5.8167 2.7613-7.346z"/><path fill="currentColor" d="m129.94 11.103-0.28094 10.43c-0.0787 2.9224-2.179 5.4794-4.9812 6.0644-2.8022 0.58492-5.4972-0.97104-6.3917-3.6903-0.89446-2.7192 0.26982-5.8167 2.7613-7.346z"/><path fill="currentColor" d="m153.76 22.997-0.28094 10.43c-0.0787 2.9224-2.179 5.4794-4.9812 6.0644-2.8022 0.58492-5.4972-0.97104-6.3917-3.6903-0.89446-2.7192 0.26982-5.8167 2.7613-7.346z"/><path fill="currentColor" d="m175.06 46.509-0.28094 10.43c-0.0787 2.9224-2.179 5.4794-4.9812 6.0644-2.8022 0.58492-5.4972-0.97104-6.3917-3.6903-0.89445-2.7192 0.26982-5.8167 2.7613-7.346z"/><path d="m74.59 170.17a12.705 12.722 0 0 0 12.705 12.722 12.705 12.722 0 0 0 12.705-12.722v-115.04" fill="none" stroke="currentColor" stroke-width="8"/></svg>',
  },

  // ── ISO 7000-2402  Do Not Stack (APPROXIMATION — no free SVG) ─────
  // No free SVG of ISO 7000-2402 exists on Wikimedia. This is our
  // stroke-based approximation following the "two stacked boxes with a
  // forbidden cross" composition shown in the standard. Replace with
  // licensed artwork from ISO if you need exact compliance.
  no_stack: {
    label: "Do Not Stack (approx.)",
    iso: "ISO 7000-2402 — approximation",
    isoNormalMm: 100, safeMinMm: 19, defaultMm: 14,
    official: false,
    svg: I(
      <>
        <rect x="6" y="18" width="20" height="9" />
        <rect x="9" y="9" width="14" height="7" />
        <line x1="3" y1="3" x2="29" y2="29" />
        <line x1="29" y1="3" x2="3" y2="29" />
      </>
    ),
  },

  // ── ISO 7000-0630  Stacking Limit by Mass (official, CC0) ─────────
  // The standard distinguishes "by mass" (0630) from "by number" (2403).
  // 2403 is not freely available; 0630 is what we ship.
  stack_limit: {
    label: "Stacking Limit by Mass",
    iso: "ISO 7000-0630",
    isoNormalMm: 100, safeMinMm: 19, defaultMm: 14,
    official: true,
    svgString: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 53.710415 53.710415"><g transform="translate(-32.682455,-93.596704)"><path fill="currentColor" d="m 52.25387,98.011163 2.09599,3.079917 -2.1456,3.07578 h 0.89297 l 1.71979,-2.53422 1.67845,2.53422 h 0.94671 l -2.1208,-3.11299 2.12493,-3.042707 h -0.8971 l -1.69499,2.501137 -1.65778,-2.501137 z m 5.80016,0 2.096,3.079917 -2.14561,3.07578 h 0.89297 l 1.71979,-2.53422 1.67845,2.53422 h 0.94671 l -2.1208,-3.11299 2.12494,-3.042707 h -0.89711 l -1.69498,2.501137 -1.65778,-2.501137 z m 8.14679,0.15296 v 6.024437 h 0.77721 v -1.54202 l 0.50436,-0.47956 1.48674,2.06447 h 1.02526 l -1.93735,-2.52749 1.58646,-1.875337 h -0.97978 l -1.68569,2.053097 v -3.717597 z m -16.8615,1.15807 -4.24161,1.699117 v 0.51263 l 4.24161,1.70998 v -0.74415 l -3.23288,-1.22214 3.23288,-1.2113 z m 22.69163,0.35657 c -0.24417,0 -0.49008,0.05353 -0.7369,0.15968 -0.24682,0.10351 -0.45639,0.249267 -0.6289,0.437697 -0.18577,0.2017 -0.33303,0.44171 -0.44184,0.72037 -0.10614,0.27602 -0.15916,0.60537 -0.15916,0.98753 0,0.698 0.15509,1.23937 0.4656,1.62419 0.31317,0.38218 0.73529,0.5731 1.26608,0.5731 0.31848,0 0.58008,-0.0438 0.78444,-0.13126 0.20701,-0.0902 0.42296,-0.2257 0.64854,-0.40618 v 0.40618 c 0,0.18048 -0.0196,0.34393 -0.0594,0.48989 -0.0398,0.14597 -0.10606,0.27064 -0.19896,0.37414 -0.0929,0.10881 -0.22296,0.19376 -0.39016,0.25476 -0.1672,0.0611 -0.37825,0.0915 -0.63303,0.0915 -0.26539,0 -0.53094,-0.0358 -0.79634,-0.10749 -0.26539,-0.069 -0.45927,-0.12738 -0.58136,-0.17518 h -0.0398 v 0.76429 c 0.21762,0.061 0.43802,0.10763 0.66094,0.13953 0.22559,0.0345 0.45678,0.0517 0.69299,0.0517 0.71126,0 1.2379,-0.17671 1.58026,-0.52969 0.34236,-0.35297 0.51366,-0.90611 0.51366,-1.65984 v -3.941356 h -0.70073 l -0.0481,0.191199 c -0.19374,-0.10612 -0.37777,-0.18411 -0.55293,-0.23461 -0.17251,-0.053 -0.3875,-0.0801 -0.64493,-0.0801 z m 0.13126,0.672827 c 0.16986,0 0.33968,0.0201 0.50953,0.0599 0.17251,0.0371 0.35802,0.101 0.55707,0.1912 v 2.42414 c 0,0.23091 -0.38485,0.25359 -0.60513,0.33849 -0.21762,0.0823 -0.43505,0.1235 -0.65267,0.1235 -0.40606,0 -0.69662,-0.12858 -0.87178,-0.38602 -0.17514,-0.25743 -0.26252,-0.63587 -0.26252,-1.13482 0,-0.52548 0.11779,-0.92597 0.35398,-1.20199 0.2362,-0.27601 0.56016,-0.41444 0.97152,-0.41444 z m -14.63735,6.74997 v 2.98948 h -3.95841 l 3.08663,3.08715 3.08715,3.08664 3.08715,-3.08664 3.08663,-3.08715 H 61.9556 v -2.98948 z m -7.80779,11.6582 v 1.33326 h 20.04632 v -1.33326 z m 1.59163,3.39825 c -1.00095,0 -1.80712,0.80565 -1.80712,1.8066 v 17.12144 c 0,1.00096 0.80617,1.80661 1.80712,1.80661 h 16.86306 c 1.00095,0 1.80661,-0.80565 1.80661,-1.80661 v -17.12144 c 0,-1.00095 -0.80566,-1.8066 -1.80661,-1.8066 z"/></g></svg>',
  },

  // ── ISO 7000-0627  Centre of Gravity (official, CC0) ──────────────
  centre_of_gravity: {
    label: "Centre of Gravity",
    iso: "ISO 7000-0627",
    isoNormalMm: 150, safeMinMm: 19, defaultMm: 14,
    official: true,
    svgString: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 53.710415 53.710415"><g transform="translate(3.453122,-62.623355)"><path fill="currentColor" d="m 21.970648,64.6992 v 13.67358 c -2.015813,0.25924 -3.866387,1.05823 -5.402254,2.24637 l 2.036568,2.03606 c 0.984604,-0.69135 2.127883,-1.1734 3.365686,-1.38597 v 6.77582 h -6.778914 c 0.21277,-1.23759 0.694709,-2.38052 1.386479,-3.36465 l -2.035535,-2.03554 c -1.187695,1.53532 -1.986322,3.3852 -2.245858,5.40019 H -1.37728 V 90.91 h 13.673583 c 0.259239,2.01581 1.058225,3.86639 2.246375,5.40225 l 2.035535,-2.03553 C 15.885945,93.29198 15.403766,92.14839 15.191217,90.91 h 6.779431 v 6.77788 c -1.237824,-0.21242 -2.381074,-0.69464 -3.365686,-1.38596 l -2.036051,2.03605 c 1.535678,1.18787 3.386287,1.98702 5.401737,2.24637 v 13.67359 h 2.865459 v -13.6741 c 2.014784,-0.25961 3.864488,-1.05829 5.39967,-2.24586 L 28.199209,96.3014 c -0.983913,0.69121 -2.126001,1.1733 -3.363102,1.38596 V 90.91 h 6.775297 c -0.212424,1.2381 -0.694748,2.38106 -1.386479,3.36569 l 2.036568,2.03656 c 1.18815,-1.53586 1.987136,-3.38644 2.246375,-5.40225 H 48.181452 V 88.04506 H 34.507868 c -0.259433,-2.01497 -1.058257,-3.8649 -2.245858,-5.40019 l -2.036568,2.03657 c 0.691158,0.98398 1.172925,2.12632 1.385445,3.36362 h -6.77478 v -6.77582 c 1.237101,0.21269 2.379215,0.6948 3.363102,1.38597 l 2.036568,-2.03657 C 28.700607,79.4311 26.850883,78.63279 24.836107,78.3733 V 64.6992 Z"/></g></svg>',
  },

  // ── ISO 7000-0632  Temperature Limit (official, CC0) ──────────────
  temp_limits: {
    label: "Temperature Limit",
    iso: "ISO 7000-0632",
    isoNormalMm: 100, safeMinMm: 19, defaultMm: 14,
    official: true,
    svgString: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><path fill="currentColor" fill-rule="evenodd" d="m100.29 13.643c-5.3121 0-9.6172 4.5863-9.6172 10.242v84.805l-35.525 54.471h-17.975v5.4766h20.941l32.559-49.924v31.863c-5.7633 3.3119-9.6484 9.5243-9.6484 16.648 0 10.601 8.5947 19.193 19.195 19.193 10.601 0 19.193-8.5928 19.193-19.193 0-7.0637-3.8193-13.232-9.502-16.564v-61.445l34.117-52.314h18.357v-5.4746h-21.324l-31.15 47.766v-55.307h-2e-3c0-5.6559-4.307-10.242-9.6191-10.242zm-0.0176 5.4688c2.3353 0 4.2285 1.8933 4.2285 4.2285 0 0.06354-3e-3 0.12665-6e-3 0.18945 2e-3 -0.03759 5e-3 -0.07535 6e-3 -0.11328v64.07l-8.457 12.967v-77.037c8.6e-4 0.03793 4e-3 0.07569 6e-3 0.11328-3e-3 -0.06281-6e-3 -0.12592-6e-3 -0.18945 0-2.3353 1.8932-4.2285 4.2285-4.2285z"/></svg>',
  },
};

window.ICON_LIBRARY = ICON_LIBRARY;
