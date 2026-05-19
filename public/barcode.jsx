// barcode.jsx — EAN-13 generation via two trusted MIT-licensed libraries.
//
// Pipeline (end-to-end, zero custom parsing on our side):
//
//   bwip-js     —→ standard EAN-13 SVG  ─→  preview (DOM insert)
//   (BWIPP port)                          │
//                                         └→  svg2pdf.js  ─→  jsPDF vector PDF
//
// • bwip-js (https://github.com/metafloor/bwip-js) is the JavaScript port
//   of BWIPP (Barcode Writer in Pure PostScript), the reference
//   implementation for barcode rendering used by Amazon, eBay, GS1 and
//   commercial label printers. With `includetext: true` it emits the
//   canonical retail look: guard bars extended below data bars into the
//   text area, plus OCR-B-style glyph outlines for the human-readable
//   digits at the standard EAN-13 positions.
//
// • svg2pdf.js (https://github.com/yWorks/svg2pdf.js) walks an SVG DOM
//   tree and re-emits every element as native jsPDF vector commands —
//   bars become PDF rectangles, glyph outlines become PDF filled paths.
//   No rasterisation; the PDF stays true vector at any zoom.
//
// Both libraries are MIT licensed (commercial use allowed). They're
// loaded from jsDelivr in Shipping Mark Template.html; this file is
// purely glue.
//
// The only logic we own here is GS1 check-digit validation (runs every
// keystroke; standalone for determinism) and a thin viewBox/size wrapper
// that adds the GS1-spec right quiet zone to bwip-js's output.

(function () {
  // ── Validation (in-house: small, deterministic, runs per keystroke) ──
  function computeCheckDigit(d12) {
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += parseInt(d12[i], 10) * (i % 2 === 0 ? 1 : 3);
    }
    return (10 - (sum % 10)) % 10;
  }

  function normalizeEan13(input) {
    const s = String(input || "").replace(/\s|-/g, "");
    if (!/^\d+$/.test(s)) {
      return { ok: false, error: "EAN-13 must be digits only." };
    }
    if (s.length === 12) {
      return { ok: true, digits: s + computeCheckDigit(s) };
    }
    if (s.length === 13) {
      const expected = computeCheckDigit(s.slice(0, 12));
      if (expected !== parseInt(s[12], 10)) {
        return { ok: false, error: `Invalid check digit (expected ${expected}, got ${s[12]}).` };
      }
      return { ok: true, digits: s };
    }
    return { ok: false, error: `EAN-13 must be 12 or 13 digits (got ${s.length}).` };
  }

  // ── Layout constants ───────────────────────────────────────────────
  // GS1 General Specifications §5.2.3 quiet zones:
  //   Left:  11 modules (bwip-js's `includetext: true` already includes this)
  //   Right:  7 modules (bwip-js only includes ~1 module — we extend by 6)
  // EAN-13 total = 11 + 95 + 7 = 113 modules wide.
  const LEFT_QZ_MODULES  = 11;
  const RIGHT_QZ_MODULES = 7;
  const TOTAL_MODULES    = LEFT_QZ_MODULES + 95 + RIGHT_QZ_MODULES;
  // bwip-js's `includetext: true` output appears to include only the
  // 11 left + ~1 right modules; we extend right by this much:
  const BWIP_EXTRA_RIGHT_QZ = 6;
  // bwip-js reserves a fixed 5.31-unit strip below the data bars for the
  // human-readable digits + guard-bar extensions when `includetext: true`.
  // Verified empirically across bar heights 10–40 mm: the strip height is
  // a constant, independent of `height`. (It's the OCR-B cap height + the
  // textyoffset, in BWIPP's pt-based coord system.)
  const TEXT_STRIP_UNITS = 5.31;

  function widthMm({ xDimMm }) {
    return TOTAL_MODULES * xDimMm;
  }

  // ── bwip-js → standard EAN-13 SVG ──────────────────────────────────
  // Returns the verbatim bwip-js SVG string for the canonical retail
  // look (guard bars extended below data, OCR-B glyphs, GS1 left QZ).
  // We then wrap it for preview / PDF use.
  function bwipFullSvg(digits, heightMm, includeText) {
    if (!window.bwipjs) {
      throw new Error(
        "bwip-js failed to load. Check the script tag in Shipping Mark Template.html — " +
        "the barcode cannot be generated without it.",
      );
    }
    return window.bwipjs.toSVG({
      bcid:           "ean13",
      text:           digits,
      scaleX:         1,
      scaleY:         1,
      height:         heightMm,
      includetext:    includeText,
      textsize:       9,
      textyoffset:    1,
      paddingwidth:   0,
      paddingheight:  0,
      backgroundcolor: "FFFFFF",
    });
  }

  // ── Preview SVG ────────────────────────────────────────────────────
  // Thin wrapper around bwip-js's output. Three tweaks only:
  //   1. Extend viewBox right by 6 modules → GS1-spec 7-module right QZ.
  //   2. Override width/height attrs → physical mm for accurate print.
  //   3. Strip the bwip-js white background rect → we sit on a white
  //      card; no need for a white block that could obscure neighbours.
  function toSvg({ digits, heightMm, xDimMm, includeText = true }) {
    const norm = normalizeEan13(digits);
    if (!norm.ok) throw new Error(norm.error);

    const raw = bwipFullSvg(norm.digits, heightMm, includeText);

    // Parse bwip's viewBox to get its native dimensions.
    const vbMatch = /viewBox="([^"]+)"/.exec(raw);
    if (!vbMatch) throw new Error("bwip-js returned SVG without a viewBox.");
    const [, , origVbW_str, vbH_str] = vbMatch[1].split(/\s+/);
    const origVbW = parseFloat(origVbW_str);
    const vbH     = parseFloat(vbH_str);

    // Physical width: 11 + 95 + 7 = 113 modules × X-dim.
    // Physical height: scaled so the *data bars* end up `heightMm` tall.
    //   bwip-js's vbH = dataBarUnits + TEXT_STRIP_UNITS (when includetext)
    //   We want dataBarUnits → heightMm, so total physical = heightMm × vbH / dataBarUnits.
    const textStripUnits = includeText ? TEXT_STRIP_UNITS : 0;
    const dataBarUnits   = vbH - textStripUnits;
    const newVbW   = origVbW + BWIP_EXTRA_RIGHT_QZ;
    const physWmm  = TOTAL_MODULES * xDimMm;
    const physHmm  = heightMm * vbH / dataBarUnits;

    return raw
      // Strip the white background rect (handle whitespace variations).
      .replace(/<rect\s+[^>]*?fill="#FFFFFF"[^>]*?\/>\s*/i, "")
      // Extend the viewBox right by 6 modules → GS1-spec 7-module right QZ.
      .replace(/\sviewBox="[^"]*"/, ` viewBox="0 0 ${newVbW} ${vbH}"`)
      // bwip's SVG has no width/height attrs — insert them at physical mm
      // so screen + print render at exact physical size.
      //
      // preserveAspectRatio="none" is REQUIRED here: the viewBox aspect
      // (113 modules × ~58 pts ≈ 1.95) doesn't match the physical
      // container aspect (113×xDimMm by physHmm). With the default
      // `xMidYMid meet` the browser uniform-scales the viewBox to fit
      // one axis, leaving empty space on the other — and bwip-js's
      // glyph paths (positioned at y≈50-58) then visually overlap the
      // data bars (y=0-52.69) because both get squashed into the same
      // physical height. Forcing non-uniform stretch keeps each axis at
      // exactly the user's chosen X-dim and bar height; the OCR-B
      // glyphs end up slightly taller than wide but still scan + read
      // perfectly.
      .replace(
        /<svg\s/,
        `<svg width="${physWmm}mm" height="${physHmm}mm" ` +
        `preserveAspectRatio="none" ` +
        `shape-rendering="crispEdges" ` +
        `data-ean="${norm.digits}" data-engine="bwip-js+svg2pdf" `,
      );
  }

  // ── PDF export ─────────────────────────────────────────────────────
  // Generates the SVG via toSvg(), parses it into a DOM Element, and
  // hands it to svg2pdf.js which converts every <rect>/<path>/<text>
  // into native jsPDF vector commands.
  //
  // Returns a Promise (svg2pdf is async). Callers in app.jsx must await.
  async function drawToPdf(pdf, opts) {
    const { digits, x, y, xDimMm, heightMm,
            includeText = true } = opts;
    const norm = normalizeEan13(digits);
    if (!norm.ok) throw new Error(norm.error);
    if (!window.svg2pdf) {
      throw new Error(
        "svg2pdf.js failed to load. Check the script tag in Shipping Mark Template.html — " +
        "vector PDF rendering requires it.",
      );
    }

    const svgString = toSvg({ digits: norm.digits, heightMm, xDimMm, includeText });

    // Parse into a real DOM element (svg2pdf walks the DOM, not strings).
    const svgEl = new DOMParser()
      .parseFromString(svgString, "image/svg+xml")
      .documentElement;

    // Physical dimensions: same formula as the preview SVG so what the
    // user sees on screen exactly matches the printed output.
    const physWmm = TOTAL_MODULES * xDimMm;
    const vbMatch = /viewBox="([^"]+)"/.exec(svgString);
    const vbH = vbMatch ? parseFloat(vbMatch[1].split(/\s+/)[3]) : heightMm;
    const textStripUnits = includeText ? TEXT_STRIP_UNITS : 0;
    const dataBarUnits = vbH - textStripUnits;
    const physHmm = heightMm * vbH / dataBarUnits;

    // svg2pdf returns a Promise that resolves once the SVG is fully
    // embedded as PDF vector commands. The viewBox is scaled into the
    // (width, height) rect we pass.
    await window.svg2pdf(svgEl, pdf, {
      x: x,
      y: y,
      width:  physWmm,
      height: physHmm,
    });
  }

  // ── Self-check ─────────────────────────────────────────────────────
  // Runs on first load. Confirms both libraries are wired up correctly;
  // logs the bwip-js + svg2pdf.js versions so the user has visible
  // evidence in the console that the pipeline is working.
  function selfCheck() {
    try {
      if (!window.bwipjs) throw new Error("bwip-js not loaded");
      const svg = bwipFullSvg("5901234123457", 20, true);
      if (!/viewBox="[^"]+"/.test(svg)) throw new Error("bwip-js returned no viewBox");
      const svg2pdfStatus = window.svg2pdf
        ? "svg2pdf.js loaded"
        : "svg2pdf.js NOT loaded (PDF export will fail)";
      console.info(
        "[Vyke Create] Barcode pipeline ready: bwip-js v" +
        (window.bwipjs.BWIPJS_VERSION || "?") +
        " (BWIPP " + (window.bwipjs.BWIPP_VERSION || "?") +
        ") → " + svg2pdfStatus + ". Test EAN 5901234123457 → " +
        svg.length + " bytes of standard EAN-13 SVG.",
      );
      if (!window.svg2pdf) {
        console.warn("[Vyke Create] svg2pdf.js missing; preview will work but PDF export will throw.");
      }
    } catch (e) {
      console.error("[Vyke Create] Barcode self-check FAILED:", e);
    }
  }

  window.BARCODE = {
    computeCheckDigit,
    normalizeEan13,
    toSvg,
    drawToPdf,
    widthMm,
    engine: "bwip-js+svg2pdf",
  };

  if (window.bwipjs && window.svg2pdf) selfCheck();
  else window.addEventListener("load", selfCheck);
})();
