// barcode.jsx — EAN-13 generator (bwip-js encoding + clean mm SVG).
//
// Approach: use bwip-js ONLY for the bar pattern (which it computes per
// the BWIPP/ISO/IEC 15420 reference and is bit-for-bit correct), then
// build our own SVG from scratch in pure millimetre coordinates.
//
// Why we re-emit instead of using bwip-js's SVG directly: bwip-js's
// default output uses a mixed coordinate system (X in modules, Y in
// BWIPP points) AND overlaps the OCR-B digit glyph paths with the
// bottom of the bars. Both quirks were causing real bugs:
//   - svg2pdf rendering aspect issues from the mixed-unit viewBox.
//   - Visible bar-through-digit overlap in both preview and PDF.
//
// By extracting just the bar (cx, width) data from bwip-js and
// composing our own SVG, every coordinate is in millimetres, the
// viewBox matches the container 1:1 (no preserveAspectRatio juggling),
// and bars + Helvetica text live in clearly separated horizontal
// strips with a known gap. svg2pdf sees plain `<rect>` and `<text>`
// elements at exact mm positions and renders them without surprises.
//
// What this module exports:
//   - computeCheckDigit(d12) / normalizeEan13(input)  — GS1 validation
//   - toSvg({digits, heightMm, xDimMm, includeText})  — preview SVG
//   - drawToPdf(pdf, opts)                            — vector PDF emit
//   - widthMm({xDimMm})                               — total mm width

(function () {
  // ── Validation (in-house: small, runs every keystroke) ────────────
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

  // ── EAN-13 layout constants (module = X-dim units wide) ───────────
  // GS1 General Specifications §5.2.3:
  //   Left quiet zone:  11 modules
  //   Symbol bars:      95 modules (3 guard + 42 left + 5 guard + 42 right + 3 guard)
  //   Right quiet zone:  7 modules
  //   Total:           113 modules end-to-end
  const LEFT_QZ_MODULES  = 11;
  const RIGHT_QZ_MODULES = 7;
  const TOTAL_MODULES    = LEFT_QZ_MODULES + 95 + RIGHT_QZ_MODULES;

  // Guard bar centres in bwip-js's no-text output (in module units,
  // before our LEFT_QZ offset). These 6 bars are the "elongated"
  // guards in the canonical EAN-13 look — they extend DOWN through
  // the human-readable text strip, framing the digit groups.
  //   Left guard (101 pattern):  bars at modules 0 and 2
  //   Centre guard (01010):      bars at modules 46 and 48
  //   Right guard (101):         bars at modules 92 and 94
  // Each guard bar is 1 module wide, so its centre sits at module + 0.5.
  const GUARD_BAR_CXS = new Set([0.5, 2.5, 46.5, 48.5, 92.5, 94.5]);

  // Layout proportions matching the Wikipedia canonical EAN-13 SVG
  // (https://commons.wikimedia.org/wiki/File:EAN-13-5901234123457.svg),
  // which itself follows ISO/IEC 15420 §A. All measured in MODULES so
  // everything scales correctly with the user's chosen X-dim:
  //
  //   - Guard extension below data bars: 5 modules (the spec value).
  //   - Text top:  right under data bars, with a 1-module gap above.
  //   - Text cap height: 8 modules.
  //   - Text bottom therefore extends BELOW the guard bars by
  //     (1 + 8) − 5 = 4 modules — the "digits hang below guards"
  //     effect you see in real retail barcodes.
  //
  // The text is NOT confined within the guard extension. Guards cover
  // only the UPPER portion of the digits; the lower halves sit in
  // white space. This is the canonical look the user asked for.
  const GUARD_EXTENSION_MODULES = 5;
  const TEXT_GAP_MODULES        = 1;
  const TEXT_HEIGHT_MODULES     = 8;

  // OCR-B is the ISO-defined font for EAN-13 HRI; few browsers ship
  // it, so we declare it first and fall back through Courier (jsPDF
  // built-in monospace, used by svg2pdf for the PDF render) to generic
  // monospace. Result: PDF gets Courier; browser previews get the
  // best installed monospace, which always looks more "barcode-y"
  // than a proportional sans like Helvetica.
  const HRI_FONT_FAMILY = "'OCR-B', 'OCR B Std', 'Courier New', Courier, monospace";

  // Total physical width including both quiet zones.
  function widthMm({ xDimMm }) {
    return TOTAL_MODULES * xDimMm;
  }

  // ── Extract bar pattern from a bwip-js "no-text" SVG ──────────────
  // With includetext: false / paddingwidth: 0 / paddingheight: 0,
  // bwip-js outputs the 95-module bar symbol starting at x=0 (no left
  // QZ in the SVG itself). Bars are encoded as <path stroke="#000000"
  // stroke-width="N" d="M cx Y_bot L cx 0 M cx Y_bot L cx 0 …">
  // where each M..L pair is one bar centred on cx with the given width.
  // We extract (cx, w) per bar; Y is uniform here (no guard extensions
  // in no-text mode) so we render every bar at the full requested
  // heightMm in our own SVG.
  function extractBars(bwipSvgString) {
    const bars = [];
    const pathRe = /<path[^>]*?stroke="#000000"[^>]*?stroke-width="([\d.]+)"[^>]*?d="([^"]+)"/g;
    let pm;
    while ((pm = pathRe.exec(bwipSvgString)) !== null) {
      const w = parseFloat(pm[1]);
      const segRe = /M\s*([\d.-]+)\s+[\d.-]+\s*L\s*[\d.-]+\s+[\d.-]+/g;
      let s;
      while ((s = segRe.exec(pm[2])) !== null) {
        bars.push({ cx: parseFloat(s[1]), w });
      }
    }
    return bars;
  }

  // ── Generate the bar pattern via bwip-js ──────────────────────────
  function getBars(digits, heightMm) {
    if (!window.bwipjs) {
      throw new Error(
        "bwip-js failed to load. Check the script tag in Shipping " +
        "Mark Template.html — the barcode cannot be generated without it.",
      );
    }
    const raw = window.bwipjs.toSVG({
      bcid:           "ean13",
      text:           digits,
      scaleX:         1,
      scaleY:         1,
      height:         heightMm,
      includetext:    false,     // bars only; we render text ourselves
      paddingwidth:   0,
      paddingheight:  0,
      backgroundcolor: "FFFFFF",
    });
    return extractBars(raw);
  }

  // ── Build clean mm-coordinate SVG ─────────────────────────────────
  // Every dimension is in millimetres. viewBox matches the physical
  // width/height 1:1 so there's no aspect-ratio juggling. svg2pdf
  // walks plain <rect> and <text> elements with explicit mm positions.
  //
  // Vertical layout (all measured down from y=0 at the bar tops):
  //   y = 0              top of all bars
  //   y = heightMm       bottom of data bars
  //   y = heightMm + 5X  bottom of guard bars (5 modules extension)
  //   y = heightMm + 1X  text top (= 1 module below data bars)
  //   y = heightMm + 9X  text bottom (text is 8 modules tall)
  //                       → 4 modules of text hang BELOW guards
  //   y = physHmm        SVG bottom = max(guard bottom, text bottom)
  function buildSvg(digits, heightMm, xDimMm, includeText) {
    const bars = getBars(digits, heightMm);

    const physWmm = TOTAL_MODULES * xDimMm;
    const guardExtMm = includeText ? GUARD_EXTENSION_MODULES * xDimMm : 0;
    const textGapMm = includeText ? TEXT_GAP_MODULES * xDimMm : 0;
    const textHeightMm = includeText ? TEXT_HEIGHT_MODULES * xDimMm : 0;
    const guardBottomMm = heightMm + guardExtMm;
    const textBottomMm  = heightMm + textGapMm + textHeightMm;
    const physHmm = Math.max(guardBottomMm, textBottomMm);

    // Render each bar as a <rect>. bwip-js bars are at cx=0..95 (module
    // units, no QZ); we shift them right by LEFT_QZ_MODULES so they sit
    // between the GS1-spec quiet zones in our SVG.
    //
    // Guard bars (the 6 cx positions in GUARD_BAR_CXS) extend exactly
    // 5 modules past the data bars — the standard EAN-13 guard length.
    // Data bars stop at heightMm.
    const barRects = bars
      .map((b) => {
        const isGuard = GUARD_BAR_CXS.has(b.cx);
        const xMm = (b.cx + LEFT_QZ_MODULES - b.w / 2) * xDimMm;
        const wMm = b.w * xDimMm;
        const hMm = isGuard ? guardBottomMm : heightMm;
        return (
          `<rect x="${xMm.toFixed(3)}" y="0" ` +
          `width="${wMm.toFixed(3)}" height="${hMm.toFixed(3)}" ` +
          `fill="#000"/>`
        );
      })
      .join("");

    // Human-readable digits below the bars, positioned per the
    // ISO/IEC 15420 / GS1 EAN-13 layout:
    //   - First (system) digit: right-aligned inside the left quiet
    //     zone, 2 modules before the first bar.
    //   - Digits 2-7: centred under the left bar group (modules 14-55
    //     in our SVG, centre at module 34.5).
    //   - Digits 8-13: centred under the right bar group (modules
    //     61-102, centre at module 81.5).
    // Font: OCR-B (with monospace fallback chain — see HRI_FONT_FAMILY).
    // Cap height = 8 × X-dim; baseline sits a little above the bottom
    // of the text strip so the digits sit visually centred under the
    // guard extensions.
    let textEls = "";
    if (includeText) {
      const baselineMm = heightMm + textGapMm + textHeightMm * 0.85;
      const fontSizeMm = textHeightMm;
      // Tiny extra tracking between digits keeps each character
      // visually aligned with its bar group.
      const letterSpacingMm = xDimMm * 0.25;
      const fontAttrs =
        `font-family="${HRI_FONT_FAMILY}" ` +
        `font-size="${fontSizeMm.toFixed(3)}" ` +
        `font-weight="400" fill="#000"`;

      const firstX  = (LEFT_QZ_MODULES - 2) * xDimMm;
      const leftCx  = 34.5 * xDimMm;
      const rightCx = 81.5 * xDimMm;

      textEls =
        `<text x="${firstX.toFixed(3)}" y="${baselineMm.toFixed(3)}" ` +
        `text-anchor="end" ${fontAttrs}>${digits[0]}</text>` +
        `<text x="${leftCx.toFixed(3)}" y="${baselineMm.toFixed(3)}" ` +
        `text-anchor="middle" letter-spacing="${letterSpacingMm.toFixed(3)}" ` +
        `${fontAttrs}>${digits.slice(1, 7)}</text>` +
        `<text x="${rightCx.toFixed(3)}" y="${baselineMm.toFixed(3)}" ` +
        `text-anchor="middle" letter-spacing="${letterSpacingMm.toFixed(3)}" ` +
        `${fontAttrs}>${digits.slice(7, 13)}</text>`;
    }

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" ` +
      `width="${physWmm.toFixed(3)}mm" ` +
      `height="${physHmm.toFixed(3)}mm" ` +
      `viewBox="0 0 ${physWmm.toFixed(3)} ${physHmm.toFixed(3)}" ` +
      `shape-rendering="crispEdges" ` +
      `data-ean="${digits}" data-engine="bwip-js+mm-svg">` +
      `${barRects}${textEls}` +
      `</svg>`
    );
  }

  // ── Preview SVG ────────────────────────────────────────────────────
  function toSvg({ digits, heightMm, xDimMm, includeText = true }) {
    const norm = normalizeEan13(digits);
    if (!norm.ok) throw new Error(norm.error);
    return buildSvg(norm.digits, heightMm, xDimMm, includeText);
  }

  // ── PDF export via svg2pdf.js ─────────────────────────────────────
  async function drawToPdf(pdf, opts) {
    const { digits, x, y, xDimMm, heightMm, includeText = true } = opts;
    const norm = normalizeEan13(digits);
    if (!norm.ok) throw new Error(norm.error);
    if (typeof pdf.svg !== "function") {
      throw new Error(
        "svg2pdf.js failed to load (pdf.svg method missing). Check " +
        "the script tag in Shipping Mark Template.html — vector PDF " +
        "rendering requires it.",
      );
    }

    const svgString = buildSvg(norm.digits, heightMm, xDimMm, includeText);
    const svgEl = new DOMParser()
      .parseFromString(svgString, "image/svg+xml")
      .documentElement;

    // Physical dimensions in pure mm — derived with the same formula
    // as buildSvg so preview and PDF use exactly the same container.
    // physHmm is max(guard bottom, text bottom); the text typically
    // hangs a few modules below the guard bars in the canonical look.
    const physWmm = TOTAL_MODULES * xDimMm;
    const guardBottomMm = heightMm + (includeText ? GUARD_EXTENSION_MODULES * xDimMm : 0);
    const textBottomMm  = heightMm + (includeText ? (TEXT_GAP_MODULES + TEXT_HEIGHT_MODULES) * xDimMm : 0);
    const physHmm = Math.max(guardBottomMm, textBottomMm);

    await pdf.svg(svgEl, { x, y, width: physWmm, height: physHmm });
  }

  // ── Self-check ─────────────────────────────────────────────────────
  function selfCheck() {
    try {
      if (!window.bwipjs) throw new Error("bwip-js not loaded");
      const bars = getBars("5901234123457", 20);
      // EAN-13 has 30 bar runs (3 left guard + 12 left digits + 3
      // centre + 12 right digits) when counted as continuous module
      // runs. Sanity-check the extractor produced something sensible.
      if (bars.length < 25 || bars.length > 35) {
        throw new Error(`unexpected bar count: ${bars.length} (expected ~30)`);
      }
      const svg2pdfStatus = (typeof window.jspdf !== "undefined" &&
                             typeof window.jspdf.jsPDF.prototype.svg === "function")
        ? "svg2pdf.js loaded"
        : "svg2pdf.js NOT loaded (PDF export will fail)";
      console.info(
        "[Vyke Create] Barcode pipeline ready: bwip-js v" +
        (window.bwipjs.BWIPJS_VERSION || "?") +
        " (BWIPP " + (window.bwipjs.BWIPP_VERSION || "?") + ") → " +
        svg2pdfStatus + ". Test EAN 5901234123457 → " +
        bars.length + " bars extracted.",
      );
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
    engine: "bwip-js+mm-svg",
  };

  if (window.bwipjs) selfCheck();
  else window.addEventListener("load", selfCheck);
})();
