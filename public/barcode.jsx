// barcode.jsx — EAN-13 encoder + SVG renderer + jsPDF vector emitter.
//
// We implement the EAN-13 spec directly (ISO/IEC 15420 §5) instead of relying
// on a third-party CDN library — this keeps the encoding fully deterministic,
// removes a runtime dependency, and lets the output be drawn into the PDF as
// pure vector rectangles with no rasterisation step. Every bar is positioned
// at an exact integer multiple of the X-dimension.
//
// Spec recap (used to derive the constants below):
//   - 95 modules total: left guard (3) + 6 left digits (42) + centre (5)
//     + 6 right digits (42) + right guard (3).
//   - Each digit is 7 modules wide.
//   - Quiet zone: 11 modules each side (GS1 General Specs §5.2.3.1).
//   - First (system) digit selects parity pattern for left half.
//   - Right half always uses R-code (mirror of L).
//
// Tables verified against canonical examples (e.g. 5901234123457 → check 7).

(function () {
  const L = ["0001101","0011001","0010011","0111101","0100011",
             "0110001","0101111","0111011","0110111","0001011"];
  const G = ["0100111","0110011","0011011","0100001","0011101",
             "0111001","0000101","0010001","0001001","0010111"];
  const R = ["1110010","1100110","1101100","1000010","1011100",
             "1001110","1010000","1000100","1001000","1110100"];
  // Parity pattern selects L or G for each of the 6 left-half digits,
  // indexed by the first (system) digit.
  const PARITY = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG",
                  "LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];

  // ── Check digit (GS1) ──────────────────────────────────────────────
  // Multiply each of the first 12 digits left-to-right by alternating
  // weights 1,3,1,3,…; sum; check = (10 − (sum mod 10)) mod 10.
  function computeCheckDigit(d12) {
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += parseInt(d12[i], 10) * (i % 2 === 0 ? 1 : 3);
    }
    return (10 - (sum % 10)) % 10;
  }

  // Returns { ok, digits, error }. Accepts 12 or 13 digits.
  function normalizeEan13(input) {
    const s = String(input || "").replace(/\s|-/g, "");
    if (!/^\d+$/.test(s)) {
      return { ok: false, error: "EAN-13 must be digits only." };
    }
    if (s.length === 12) {
      const c = computeCheckDigit(s);
      return { ok: true, digits: s + c };
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

  // ── Encode 13 digits to a 95-element module array (1 = bar) ────────
  function encode(digits13) {
    const first = parseInt(digits13[0], 10);
    const pat = PARITY[first];
    const left = digits13.slice(1, 7);
    const right = digits13.slice(7, 13);
    let bits = "101"; // left guard
    for (let i = 0; i < 6; i++) {
      const d = parseInt(left[i], 10);
      bits += pat[i] === "L" ? L[d] : G[d];
    }
    bits += "01010"; // centre guard
    for (let i = 0; i < 6; i++) {
      const d = parseInt(right[i], 10);
      bits += R[d];
    }
    bits += "101"; // right guard
    if (bits.length !== 95) throw new Error("EAN-13 encode produced wrong length");
    return bits;
  }

  // ── Render to inline <svg> at exact physical dimensions ────────────
  // heightMm = height of the bars (excluding the human-readable text row).
  // xDimMm   = width of one module (GS1 default 0.330mm; range 0.264–0.660).
  // quietZoneModules = quiet zone width in modules each side (default 11 = GS1 spec).
  // The first system digit sits in the LEFT quiet zone; the next 6 sit under the
  // left bar group; the final 6 sit under the right bar group. Guard bars extend
  // 5×xDim below the data bars, traditionally — we leave that detail off the
  // preview to keep things simple and reintroduce it in the vector PDF emit if
  // needed. For accuracy of the encoded data we only care about the bars.
  function toSvg({ digits, heightMm, xDimMm, quietZoneModules = 11, includeText = true, textHeightMm = 2.75 }) {
    const norm = normalizeEan13(digits);
    if (!norm.ok) throw new Error(norm.error);
    const bits = encode(norm.digits);
    const QZ = quietZoneModules;
    const totalModules = QZ + 95 + QZ;
    const widthMm = totalModules * xDimMm;
    const totalH = heightMm + (includeText ? textHeightMm : 0);

    // Build the bar rects (concatenate runs of 1s for fewer rects).
    const rects = [];
    let i = 0;
    while (i < 95) {
      if (bits[i] === "1") {
        let j = i;
        while (j < 95 && bits[j] === "1") j++;
        rects.push({ x: (QZ + i) * xDimMm, w: (j - i) * xDimMm });
        i = j;
      } else i++;
    }
    const barRects = rects.map(r =>
      `<rect x="${r.x.toFixed(4)}" y="0" width="${r.w.toFixed(4)}" height="${heightMm}" fill="#000"/>`
    ).join("");

    // Human-readable digits, positioned per ISO/IEC 15420:
    //   - first digit:  in the left quiet zone, baseline-aligned to bottom of bars
    //   - digits 2-7:   centred under the left half (between left guard and centre)
    //   - digits 8-13:  centred under the right half (between centre and right guard)
    const textY = heightMm + textHeightMm * 0.85;
    const textSize = textHeightMm * 0.95;
    const fontStyle = `font-family="Helvetica,Arial,sans-serif" font-size="${textSize}" font-weight="400" fill="#000"`;

    const firstX = (QZ - 2) * xDimMm; // sits inside the left quiet zone
    const leftGroupCx = (QZ + 3 + (6 * 7) / 2) * xDimMm; // centre of digits 2-7
    const rightGroupCx = (QZ + 3 + 42 + 5 + (6 * 7) / 2) * xDimMm; // centre of digits 8-13

    let textEls = "";
    if (includeText) {
      textEls += `<text x="${firstX.toFixed(4)}" y="${textY.toFixed(4)}" text-anchor="end" ${fontStyle}>${norm.digits[0]}</text>`;
      textEls += `<text x="${leftGroupCx.toFixed(4)}" y="${textY.toFixed(4)}" text-anchor="middle" letter-spacing="${(xDimMm * 0.4).toFixed(4)}" ${fontStyle}>${norm.digits.slice(1, 7)}</text>`;
      textEls += `<text x="${rightGroupCx.toFixed(4)}" y="${textY.toFixed(4)}" text-anchor="middle" letter-spacing="${(xDimMm * 0.4).toFixed(4)}" ${fontStyle}>${norm.digits.slice(7, 13)}</text>`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${totalH}mm" viewBox="0 0 ${widthMm} ${totalH}" shape-rendering="crispEdges" data-ean="${norm.digits}">${barRects}${textEls}</svg>`;
  }

  // ── Draw vector bars + text into a jsPDF instance ─────────────────
  // pdf must be a jsPDF instance. Origin x,y is the TOP-LEFT of the bar block
  // (NOT including the quiet zone — quiet zone is added on both sides). All
  // dimensions in millimetres (assumes pdf was created with `unit: 'mm'`).
  function drawToPdf(pdf, opts) {
    const { digits, x, y, xDimMm, heightMm,
            quietZoneModules = 11,
            includeText = true,
            textHeightMm = 2.75 } = opts;
    const norm = normalizeEan13(digits);
    if (!norm.ok) throw new Error(norm.error);
    const bits = encode(norm.digits);
    const QZ = quietZoneModules;

    // CMYK pure black — no transparency, no blend.
    pdf.setFillColor(0, 0, 0, 1);

    // Walk runs of 1s to emit fewer rect ops.
    let i = 0;
    while (i < 95) {
      if (bits[i] === "1") {
        let j = i;
        while (j < 95 && bits[j] === "1") j++;
        const bx = x + (QZ + i) * xDimMm;
        const bw = (j - i) * xDimMm;
        pdf.rect(bx, y, bw, heightMm, "F");
        i = j;
      } else i++;
    }

    if (includeText) {
      pdf.setTextColor(0, 0, 0, 1);
      pdf.setFont("Helvetica", "normal");
      // Convert mm cap-height to pt (≈1.4× cap-height for most fonts)
      pdf.setFontSize(textHeightMm * 0.95 * 2.83465);

      const baselineY = y + heightMm + textHeightMm * 0.85;
      const firstX = x + (QZ - 2) * xDimMm;
      const leftGroupCx = x + (QZ + 3 + (6 * 7) / 2) * xDimMm;
      const rightGroupCx = x + (QZ + 3 + 42 + 5 + (6 * 7) / 2) * xDimMm;

      pdf.text(norm.digits[0], firstX, baselineY, { align: "right" });
      pdf.text(norm.digits.slice(1, 7), leftGroupCx, baselineY,
               { align: "center", charSpace: xDimMm * 0.4 });
      pdf.text(norm.digits.slice(7, 13), rightGroupCx, baselineY,
               { align: "center", charSpace: xDimMm * 0.4 });
    }
  }

  // Width helper — useful for layouts that need to reserve space.
  function widthMm({ xDimMm, quietZoneModules = 11 }) {
    return (quietZoneModules * 2 + 95) * xDimMm;
  }

  window.BARCODE = {
    computeCheckDigit,
    normalizeEan13,
    encode,
    toSvg,
    drawToPdf,
    widthMm,
  };
})();
