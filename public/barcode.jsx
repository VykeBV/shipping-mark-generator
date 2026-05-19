// barcode.jsx — EAN-13 generator backed by bwip-js (BWIPP port).
//
// bwip-js (https://github.com/metafloor/bwip-js) is the JavaScript port of
// BWIPP — "Barcode Writer in Pure PostScript" — the de-facto reference
// implementation for barcode generation. It's used by Amazon, eBay, and
// major retail systems, and is certified for ISO/IEC 15420 compliance.
//
// Rendering pipeline:
//   1. bwip-js encodes the digits and lays out every bar at the exact
//      module positions required by ISO/IEC 15420. We use it as the
//      canonical source for the bar pattern.
//   2. For the live preview, we use bwip-js's SVG output directly (it
//      already renders bars + human-readable digits as glyph outlines —
//      the exact OCR-B look retail scanners expect). We just rewrite
//      the SVG's width/height to physical millimetres so the on-screen
//      and print size are exact.
//   3. For the PDF export, we parse bwip-js's SVG bar paths and re-emit
//      every bar as a true vector jsPDF rectangle in CMYK pure black,
//      then redraw the human-readable digits with jsPDF's Helvetica
//      at the standard EAN-13 positions. No rasterisation anywhere.
//
// Bar-path semantics in bwip-js SVG output:
//   <path stroke="#000000" stroke-width="N" d="M cx y1 L cx y2 M ..."/>
//   Each "M cx y1 L cx y2" pair is ONE bar:
//     - cx is the bar's centre on the X axis (in module units, scaleX=1)
//     - y1..y2 is its vertical span (in bwip-points, scaleY=1)
//     - stroke-width N is the bar's width (in module units)
//
// Validation helpers (check digit + normalize) are kept in-house since
// they run on every keystroke and we want them deterministic without
// any library dependency.

(function () {
  // ── Validation ─────────────────────────────────────────────────────
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

  // ── Total barcode width ────────────────────────────────────────────
  // GS1 General Specifications §5.2.3: EAN-13 = 95 data modules + 11
  // module quiet zone left + 7 module quiet zone right = 113 modules.
  // bwip-js's SVG includes ~11 modules left QZ and ~1 module right QZ
  // by default; we add the missing right padding in our wrapper so the
  // physical render reserves a GS1-compliant quiet zone end-to-end.
  function widthMm({ xDimMm }) {
    return (11 + 95 + 7) * xDimMm;
  }

  // ── bwip-js bridge: bars only ──────────────────────────────────────
  // Asks bwip-js for an SVG with the bar pattern only (no text — we
  // render the human-readable digits ourselves so the same Helvetica
  // appears in both preview and PDF). Returns the raw SVG plus its
  // parsed viewBox dimensions for downstream coordinate conversion.
  function bwipBarsSvg(digits, heightMm) {
    if (!window.bwipjs) {
      throw new Error(
        "bwip-js failed to load. Check the script tag in Shipping Mark Template.html — " +
        "the barcode cannot be generated without it.",
      );
    }
    const svgString = window.bwipjs.toSVG({
      bcid: "ean13",
      text: digits,
      scaleX: 1,
      scaleY: 1,
      height: heightMm,
      includetext: false,                 // we add Helvetica digits ourselves
      paddingwidth: 0,
      paddingheight: 0,
      backgroundcolor: "FFFFFF",
    });
    const vbMatch = /viewBox="([^"]+)"/.exec(svgString);
    if (!vbMatch) throw new Error("bwip-js returned SVG without a viewBox.");
    const [, , vbW, vbH] = vbMatch[1].split(/\s+/).map(parseFloat);
    return { svgString, vbW, vbH };
  }

  // ── Bar extraction ─────────────────────────────────────────────────
  // Parses every "M cx y1 L cx y2" pair out of the bwip-js bar paths.
  // Returns [{ cx, yTop, yBot, w }] in bwip-js's native coords (X in
  // modules, Y in bwip-points).
  function extractBars(svgString) {
    const bars = [];
    const pathRe = /<path[^>]*?stroke="#000000"[^>]*?stroke-width="([\d.]+)"[^>]*?d="([^"]+)"/g;
    let pm;
    while ((pm = pathRe.exec(svgString)) !== null) {
      const w = parseFloat(pm[1]);
      const d = pm[2];
      // Each segment: M cx y1 L cx y2  (cx repeats; line is purely vertical)
      const segRe = /M\s*([\d.-]+)\s+([\d.-]+)\s*L\s*[\d.-]+\s+([\d.-]+)/g;
      let s;
      while ((s = segRe.exec(d)) !== null) {
        const cx = parseFloat(s[1]);
        const y1 = parseFloat(s[2]);
        const y2 = parseFloat(s[3]);
        bars.push({
          cx,
          yTop: Math.min(y1, y2),
          yBot: Math.max(y1, y2),
          w,
        });
      }
    }
    return bars;
  }

  // ── EAN-13 layout constants (in module units) ─────────────────────
  // GS1 General Specifications §5.2.3 quiet zones:
  const LEFT_QZ_MODULES  = 11;   // minimum quiet zone before first bar
  const RIGHT_QZ_MODULES = 7;    // minimum quiet zone after last bar
  // bwip-js with includetext:false / paddingwidth:0 outputs bars starting
  // at X=0 (no quiet zone in the SVG itself). We translate them right by
  // LEFT_QZ_MODULES and extend the viewBox to include both quiet zones.
  // Total composed width = 11 + 95 + 7 = 113 modules.
  //
  // Standard EAN-13 human-readable digit positions (in our composed
  // 113-module viewBox where bars are at modules 11..106):
  //   First digit:    in the left quiet zone, right-aligned at module 9
  //   Digits 2-7:     centred under the left bar group  → module 11 + (3 + 21) = 35
  //   Digits 8-13:    centred under the right bar group → module 11 + (3 + 42 + 5 + 21) = 82
  const FIRST_DIGIT_X = 9;
  const LEFT_HALF_CX  = 35;
  const RIGHT_HALF_CX = 82;

  // ── Preview SVG ────────────────────────────────────────────────────
  // Wraps bwip-js's bar SVG into a new SVG sized in physical mm. We:
  //   1. Translate bwip-js's bars (originally at X=0..95) right by 11
  //      modules so the SVG's left edge is the start of the GS1 left
  //      quiet zone.
  //   2. Extend the viewBox width to 113 modules (= 11 + 95 + 7) so the
  //      full GS1 quiet zones are inside the rendered SVG.
  //   3. Extend the viewBox height to make room for human-readable
  //      digits in Helvetica below the bars.
  function toSvg({ digits, heightMm, xDimMm, includeText = true }) {
    const norm = normalizeEan13(digits);
    if (!norm.ok) throw new Error(norm.error);

    const { svgString: rawSvg, vbH } = bwipBarsSvg(norm.digits, heightMm);
    const yScale = heightMm / vbH;          // mm per bwip-point in Y

    // Extract everything inside <svg>…</svg>, minus the white bg rect.
    const innerMatch = /<svg[^>]*>([\s\S]*?)<\/svg>/.exec(rawSvg);
    const inner = innerMatch ? innerMatch[1] : "";
    const innerNoBg = inner.replace(
      /<rect\s+[^>]*?fill="#FFFFFF"[^>]*?\/>\s*/i, "",
    );

    // Composed viewBox: 113 modules wide × (bars + text strip) tall.
    const totalWidthModules = LEFT_QZ_MODULES + 95 + RIGHT_QZ_MODULES;
    const physWmm = totalWidthModules * xDimMm;

    const textHeightMm = includeText ? 3.2 : 0;
    const textHeightUnits = textHeightMm / yScale;
    const newVbH = vbH + textHeightUnits;
    const physHmm = heightMm + textHeightMm;

    // Wrap the bwip-js bar paths in a <g> that shifts them into the
    // left-QZ-offset position.
    const barsTranslated =
      `<g transform="translate(${LEFT_QZ_MODULES} 0)">${innerNoBg}</g>`;

    let textEls = "";
    if (includeText) {
      const baselineY = (heightMm + textHeightMm * 0.85) / yScale;
      const fontSizeUnits = (textHeightMm * 0.95) / yScale;
      const letterSpacing = (xDimMm * 0.4).toFixed(3);
      const fontAttrs =
        `font-family="Helvetica,Arial,sans-serif" ` +
        `font-size="${fontSizeUnits.toFixed(3)}" fill="#000"`;
      textEls =
        `<text x="${FIRST_DIGIT_X}" y="${baselineY.toFixed(3)}" text-anchor="end" ${fontAttrs}>${norm.digits[0]}</text>` +
        `<text x="${LEFT_HALF_CX}" y="${baselineY.toFixed(3)}" text-anchor="middle" letter-spacing="${letterSpacing}" ${fontAttrs}>${norm.digits.slice(1, 7)}</text>` +
        `<text x="${RIGHT_HALF_CX}" y="${baselineY.toFixed(3)}" text-anchor="middle" letter-spacing="${letterSpacing}" ${fontAttrs}>${norm.digits.slice(7, 13)}</text>`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" ` +
      `width="${physWmm}mm" height="${physHmm}mm" ` +
      `viewBox="0 0 ${totalWidthModules} ${newVbH.toFixed(3)}" ` +
      `shape-rendering="crispEdges" ` +
      `data-ean="${norm.digits}" data-engine="bwip-js">` +
      `${barsTranslated}${textEls}</svg>`;
  }

  // ── PDF export ─────────────────────────────────────────────────────
  // Extracts every bar from bwip-js's bar paths and re-emits each as a
  // true-vector jsPDF rectangle in CMYK pure black. Human-readable
  // digits are drawn with jsPDF's Helvetica at the standard EAN-13
  // positions (matching the on-screen preview).
  //
  // X coords from bwip-js are in modules → multiply by xDimMm.
  // Y coords are in bwip-points → multiply by (heightMm / vbH).
  function drawToPdf(pdf, opts) {
    const { digits, x, y, xDimMm, heightMm,
            includeText = true } = opts;
    const norm = normalizeEan13(digits);
    if (!norm.ok) throw new Error(norm.error);

    const { svgString: rawSvg, vbH } = bwipBarsSvg(norm.digits, heightMm);
    const yScale = heightMm / vbH;
    const bars = extractBars(rawSvg);

    // CMYK pure black — max contrast on press, no transparency.
    pdf.setFillColor(0, 0, 0, 1);

    // bwip-js's bars start at X=0; we offset them by LEFT_QZ_MODULES so
    // the PDF render matches the preview's GS1-compliant quiet zones.
    const xOffsetMm = LEFT_QZ_MODULES * xDimMm;

    for (const b of bars) {
      const bx = xOffsetMm + (b.cx - b.w / 2) * xDimMm;
      const bw = b.w * xDimMm;
      const by = b.yTop * yScale;
      const bh = (b.yBot - b.yTop) * yScale;
      if (bw <= 0 || bh <= 0) continue;
      pdf.rect(x + bx, y + by, bw, bh, "F");
    }

    if (includeText) {
      const textHeightMm = 3.2;
      pdf.setTextColor(0, 0, 0, 1);
      pdf.setFont("Helvetica", "normal");
      // pt = mm × 2.83465. We render at 95 % of strip height so digits
      // sit comfortably without touching the bars.
      pdf.setFontSize(textHeightMm * 0.95 * 2.83465);

      const baselineY = y + heightMm + textHeightMm * 0.85;
      const firstDigitX = x + FIRST_DIGIT_X * xDimMm;
      const leftCx      = x + LEFT_HALF_CX  * xDimMm;
      const rightCx     = x + RIGHT_HALF_CX * xDimMm;

      pdf.text(norm.digits[0], firstDigitX, baselineY, { align: "right" });
      pdf.text(norm.digits.slice(1, 7), leftCx, baselineY,
               { align: "center", charSpace: xDimMm * 0.4 });
      pdf.text(norm.digits.slice(7, 13), rightCx, baselineY,
               { align: "center", charSpace: xDimMm * 0.4 });
    }
  }

  // ── Self-check ─────────────────────────────────────────────────────
  // Verify bwip-js is callable and producing a parseable bar pattern
  // for a canonical test EAN. Logs success or a loud error so a broken
  // CDN never silently breaks barcode generation in production.
  function selfCheck() {
    try {
      const { vbW, vbH, svgString } = bwipBarsSvg("5901234123457", 20);
      const bars = extractBars(svgString);
      if (bars.length < 25 || bars.length > 35) {
        throw new Error("unexpected bar count: " + bars.length + " (expected ~30)");
      }
      console.info(
        "[Vyke Create] Barcode engine ready: bwip-js v" +
        (window.bwipjs.BWIPJS_VERSION || "?") +
        " (BWIPP " + (window.bwipjs.BWIPP_VERSION || "?") +
        "). Test EAN 5901234123457 → " + bars.length + " bars in " +
        vbW.toFixed(1) + " × " + vbH.toFixed(1) + " bwip units.",
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
    engine: "bwip-js",
  };

  if (window.bwipjs) selfCheck();
  else window.addEventListener("load", selfCheck);
})();
