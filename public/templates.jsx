// templates.jsx — shipping-mark layout templates.
//
// Each template is a self-contained module exposing four things:
//
//   {
//     id, label, blurb,                  // metadata for the picker UI
//     available,                         // false → shown in picker but disabled
//     Thumbnail,                         // small inline SVG diagram for the picker
//     Preview(props)  → React element,   // the live editor card for this template
//     drawPdf(pdf, state, ctx) → Promise // PDF export for this template
//     iconsRegionMm(state) → { availW, availH },  // layout math used by overflow
//   }
//
// app.jsx looks up the active template via window.TEMPLATES[state.template]
// and delegates rendering + export to it. Switching templates is just
// changing `state.template`; everything else (size, bleed, brand, rows,
// barcode digits, icon selection) stays the same.
//
// The 4 content blocks — Brand (logo + name), Rows (label/value pairs),
// Icons (handling icons), Barcode (EAN-13) — are the same across every
// template. Templates only choose WHERE those blocks sit and what
// decoration frames them.
//
// `Preview` receives a `ctx` prop bag carrying React + the in-app
// components/helpers it needs (BrandLogo, Editable, BarcodeView,
// getIconMeta, sizeFor, ICON_ORDER, addRow/removeRow/setRow callbacks).
// This avoids any module-import dance (we're in CDN React + Babel land,
// no bundler).
//
// `drawPdf` receives a similar `ctx` bag with PDF helpers (logoToBlackPng,
// packIcons, ICON_ORDER) and the global window.BARCODE.

(function () {
  const h = React.createElement;

  // ───── Shared layout constants ─────────────────────────────────────
  // Mirror the .sm-trim padding (5 mm × 4 mm) and the body's flex-gap,
  // so iconsRegionMm() math matches the actual CSS layout.
  const TRIM_PAD_X = 5;     // .sm-trim left/right padding (mm)
  const TRIM_PAD_Y = 4;     // .sm-trim top/bottom padding (mm)
  const HEADER_H   = 12;    // approx brand band height
  const HEADER_GAP = 2.5;   // .sm-trim flex-gap between header and body
  const BODY_GAP   = 4;     // .sm-body flex-gap between rows and icons

  // ───── Classic template ────────────────────────────────────────────
  // The original look: brand top-left, rows + icons side-by-side, barcode
  // bottom-right corner. No decorative rules. Preserves the exact JSX +
  // PDF layout the editor used before templates existed — so picking
  // Classic is identical to "no template" for both preview and export.
  const Classic = {
    id:    "classic",
    label: "Classic",
    blurb: "Brand top, rows + icons side-by-side, barcode bottom-right.",
    available: true,

    Thumbnail() {
      // 60 × 42 mini diagram echoing the layout above
      return h("svg", { viewBox: "0 0 60 42", "aria-hidden": "true" },
        h("rect", { x: 0.5, y: 0.5, width: 59, height: 41, rx: 3,
                    fill: "none", stroke: "currentColor", strokeWidth: 1, opacity: 0.4 }),
        // brand mark
        h("rect", { x: 6, y: 5, width: 16, height: 3.5, fill: "currentColor", opacity: 0.85 }),
        // rows
        h("rect", { x: 6, y: 14, width: 22, height: 1.5, fill: "currentColor", opacity: 0.55 }),
        h("rect", { x: 6, y: 18, width: 18, height: 1.5, fill: "currentColor", opacity: 0.55 }),
        h("rect", { x: 6, y: 22, width: 20, height: 1.5, fill: "currentColor", opacity: 0.55 }),
        // icons cluster
        h("rect", { x: 38, y: 13, width: 6, height: 6, fill: "currentColor", opacity: 0.7 }),
        h("rect", { x: 46, y: 13, width: 6, height: 6, fill: "currentColor", opacity: 0.7 }),
        h("rect", { x: 38, y: 21, width: 6, height: 6, fill: "currentColor", opacity: 0.7 }),
        // barcode hint
        h("g", { transform: "translate(38, 32)" },
          h("rect", { width: 1, height: 6, fill: "currentColor" }),
          h("rect", { x: 2, width: 1.5, height: 6, fill: "currentColor" }),
          h("rect", { x: 5, width: 0.8, height: 6, fill: "currentColor" }),
          h("rect", { x: 7, width: 1.2, height: 6, fill: "currentColor" }),
          h("rect", { x: 9.5, width: 1, height: 6, fill: "currentColor" }),
          h("rect", { x: 11.5, width: 1.6, height: 6, fill: "currentColor" }),
          h("rect", { x: 14, width: 0.8, height: 6, fill: "currentColor" }),
          h("rect", { x: 16, width: 1.2, height: 6, fill: "currentColor" }),
          h("rect", { x: 18.5, width: 1, height: 6, fill: "currentColor" }),
        ),
      );
    },

    iconsRegionMm(state) {
      // Same math as the original availableIconsRegionMm() in app.jsx.
      // The icons block lives in the body's right half; reserve space
      // for the barcode column (right) and the rows column (left) when
      // rows have content. With all rows empty, the rows column
      // collapses and icons get the entire body width.
      const barcodeBlockW = window.BARCODE
        ? window.BARCODE.widthMm({ xDimMm: state.barcodeXDimMm || 0.264 }) + 4
        : 36;
      const usableH = (state.heightMm || 90) - TRIM_PAD_Y * 2 - HEADER_H - HEADER_GAP;
      const bodyW   = (state.widthMm  || 130) - TRIM_PAD_X * 2 - barcodeBlockW;
      const hasRowContent = (state.rows || []).some(r =>
        (r && r.label && r.label.trim()) || (r && r.value && r.value.trim())
      );
      const minRowsW = hasRowContent ? Math.max(40, bodyW * 0.40) : 0;
      const usableW  = bodyW - minRowsW - BODY_GAP;
      return {
        availH: Math.max(0, usableH),
        availW: Math.max(0, usableW),
      };
    },

    // Live editor card. Pure layout — every editable element + handler
    // comes from `ctx`, which app.jsx populates.
    Preview({ state, ctx }) {
      const { BrandLogo, Editable, BarcodeView,
              setTweak, setRow, removeRow, addRow,
              rowAddBlocked, enabledIcons, sizeFor, getIconMeta } = ctx;
      const t = state;
      return h("div", { className: "sm-trim sm-tpl-classic" },
        h("div", { className: "sm-header" },
          h(BrandLogo, { src: t.brandLogo, bw: t.brandLogoBw }),
          h(Editable, {
            className:   "sm-brand",
            value:       t.brandName,
            onChange:    (v) => setTweak("brandName", v),
            placeholder: "BRAND",
          }),
        ),
        h("div", { className: "sm-body" },
          h("div", { className: "sm-rows" },
            (t.rows || []).map((r, i) =>
              h("div", { key: i, className: "sm-row" },
                h(Editable, {
                  className:   "sm-row-label",
                  value:       r.label,
                  onChange:    (v) => setRow(i, { ...r, label: v }),
                  placeholder: "Label",
                }),
                h(Editable, {
                  className:   "sm-row-value",
                  value:       r.value,
                  onChange:    (v) => setRow(i, { ...r, value: v }),
                  placeholder: "Value",
                }),
                h("button", {
                  className: "sm-row-remove",
                  onClick:   () => removeRow(i),
                  title:     "Remove row",
                }, "×"),
              ),
            ),
            h("button", {
              className: "sm-row-add",
              onClick:   addRow,
              disabled:  rowAddBlocked,
              title:     rowAddBlocked
                ? "No more room — make the card taller or remove a row first."
                : "Add a row",
            }, "+ Add row"),
          ),
          enabledIcons.length > 0 && h("div", { className: "sm-icons" },
            enabledIcons.map((k) => {
              const meta = getIconMeta(k, t.customIcons);
              if (!meta) return null;
              const sz = sizeFor(k, t);
              return h("div", {
                key:       k,
                className: "sm-icon",
                "data-key": k,
                title:     `${meta.label} (${sz}mm)`,
                style:     { width: `${sz}mm`, height: `${sz}mm` },
              },
                meta.svg
                  ? meta.svg
                  : h("span", {
                      style: { width: "100%", height: "100%", display: "grid", placeItems: "center" },
                      dangerouslySetInnerHTML: { __html: meta.svgString || "" },
                    }),
              );
            }),
          ),
        ),
        // Barcode is OUTSIDE the body and absolutely-positioned bottom-right
        // (mirrors the PDF render); .sm-body's padding-right keeps content
        // from sliding underneath it.
        h("div", { className: "sm-barcode" },
          h(BarcodeView, {
            digits:   t.ean13,
            heightMm: t.barcodeHeightMm,
            xDimMm:   t.barcodeXDimMm,
          }),
        ),
      );
    },

    // Word-for-word the body of the previous renderPageIntoPdf in
    // app.jsx, with the function signature changed to take a `ctx`
    // bag carrying the PDF helpers. No layout maths changed — the goal
    // for commit 1 is byte-identical PDF output vs pre-templates.
    async drawPdf(pdf, state, ctx) {
      const { logoToBlackPng, packIcons, ICON_ORDER } = ctx;
      const W = state.widthMm, H = state.heightMm, B = state.bleedMm || 0;
      const trimX = B, trimY = B;

      const setBlackFill   = () => pdf.setFillColor(0, 0, 0, 1);
      const setBlackText   = () => pdf.setTextColor(0, 0, 0, 1);
      const setBlackStroke = () => pdf.setDrawColor(0, 0, 0, 1);
      void setBlackFill;  // kept for parity with the original

      // 1. Logo (top-left of trim area)
      const PAD_X = TRIM_PAD_X, PAD_Y = TRIM_PAD_Y;
      const LOGO_MAX_W = 30, LOGO_MAX_H = 10;
      let logoBottomY = trimY + PAD_Y;
      let logoRightX  = trimX + PAD_X;
      if (state.brandLogo) {
        try {
          const src = state.brandLogoBw ? await logoToBlackPng(state.brandLogo) : state.brandLogo;
          const probe = await new Promise((res, rej) => {
            const im = new Image();
            im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
            im.onerror = rej;
            im.src = src;
          });
          const aspect = probe.w / probe.h;
          let lw = LOGO_MAX_W, lh = lw / aspect;
          if (lh > LOGO_MAX_H) { lh = LOGO_MAX_H; lw = lh * aspect; }
          pdf.addImage(src, "PNG", trimX + PAD_X, trimY + PAD_Y, lw, lh, undefined, "FAST");
          logoBottomY = trimY + PAD_Y + lh;
          logoRightX  = trimX + PAD_X + lw + 3;
        } catch (e) {
          console.warn("Logo embed failed:", e);
        }
      }

      // 2. Brand name (right of logo, vertical-centred to its height)
      if (state.brandName) {
        setBlackText();
        pdf.setFont("Helvetica", "bold");
        const sizeMm = 4.2;
        pdf.setFontSize(sizeMm * 2.83465);
        const baseY = trimY + PAD_Y + sizeMm * 0.85;
        pdf.text(state.brandName, logoRightX, baseY);
      }
      const bodyTopY = Math.max(logoBottomY, trimY + PAD_Y + 5) + 2.5;

      // 3. Reserve right-hand columns for icons + barcode
      const eanW = window.BARCODE.widthMm({ xDimMm: state.barcodeXDimMm });
      const barcodeBlockW = eanW;
      const enabledIcons = [
        ...ICON_ORDER.filter(k => state.icons && state.icons[k]),
        ...(state.customIcons || []).filter(c => state.icons && state.icons[c.key]).map(c => c.key),
      ];
      const ICON_GAP = 2;
      const iconsMaxW = Classic.iconsRegionMm(state).availW;
      const packed = packIcons(enabledIcons, state, ICON_GAP, iconsMaxW);
      const iconsBlockW = packed.totalW;

      const rightEdgeX  = trimX + W - PAD_X;
      const barcodeX    = rightEdgeX - barcodeBlockW;
      const iconsRightX = barcodeX - 4;
      const iconsLeftX  = iconsRightX - iconsBlockW;

      // 4. Text rows (left column)
      const rowsLeftX = trimX + PAD_X;
      const rowsRightLimit = iconsLeftX - 3;
      const rowSizeMm = state.rowTextSizeMm || 2.6;
      const rowGapMm  = 0.8;
      const rowLineH  = rowSizeMm * 1.25;
      setBlackText();
      pdf.setFontSize(rowSizeMm * 2.83465);
      let rowY = bodyTopY + rowSizeMm * 0.85;
      const rows = state.rows || [];
      pdf.setFont("Helvetica", "bold");
      let maxLabelW = 0;
      rows.forEach(r => {
        if (!r.label) return;
        const w = pdf.getTextWidth(r.label + ":");
        if (w > maxLabelW) maxLabelW = w;
      });
      const valueX = rowsLeftX + maxLabelW + 1.5;
      rows.forEach(r => {
        if (!r.label && !r.value) return;
        pdf.setFont("Helvetica", "bold");
        if (r.label) pdf.text(r.label + ":", rowsLeftX, rowY);
        pdf.setFont("Helvetica", "normal");
        if (r.value) {
          const maxW = Math.max(10, rowsRightLimit - valueX);
          const lines = pdf.splitTextToSize(r.value, maxW);
          pdf.text(lines, valueX, rowY);
          rowY += (lines.length - 1) * rowLineH;
        }
        rowY += rowLineH + rowGapMm;
      });

      // 5. Handling icons via svg2pdf
      if (enabledIcons.length && typeof pdf.svg === "function") {
        const card = document.querySelector(".shipping-mark");
        const svgByKey = {};
        if (card) {
          card.querySelectorAll(".sm-icon[data-key]").forEach(el => {
            const key = el.getAttribute("data-key");
            const svg = el.querySelector("svg");
            if (key && svg) svgByKey[key] = svg;
          });
        }
        const placements = packed.placements;
        for (const { key, x, y, sz } of placements) {
          const src = svgByKey[key];
          if (!src) continue;
          const cloned = src.cloneNode(true);
          cloned.querySelectorAll("[fill]").forEach((el) => {
            const f = el.getAttribute("fill");
            if (f === "currentColor") el.setAttribute("fill", "#000");
          });
          cloned.querySelectorAll("[stroke]").forEach((el) => {
            const s = el.getAttribute("stroke");
            if (s === "currentColor") el.setAttribute("stroke", "#000");
          });
          const holder = document.createElement("div");
          holder.style.cssText = "position:absolute;left:-99999px;top:-99999px;pointer-events:none;";
          holder.appendChild(cloned);
          document.body.appendChild(holder);
          try {
            await pdf.svg(cloned, {
              x: iconsLeftX + x,
              y: bodyTopY + y,
              width: sz,
              height: sz,
            });
          } catch (err) {
            console.warn("Icon", key, "failed to render via svg2pdf:", err);
          } finally {
            document.body.removeChild(holder);
          }
        }
      }

      // 6. Crop marks (corner ticks, in the bleed)
      if (state.showCropMarks && B > 0) {
        setBlackStroke();
        pdf.setLineWidth(0.15);
        const tick = Math.min(3, B);
        const draw = (x, y, dx, dy) => pdf.line(x, y, x + dx, y + dy);
        draw(trimX - tick, trimY,         tick - 0.5, 0);
        draw(trimX,        trimY - tick,  0, tick - 0.5);
        draw(trimX + W + 0.5, trimY,      tick - 0.5, 0);
        draw(trimX + W,    trimY - tick,  0, tick - 0.5);
        draw(trimX - tick, trimY + H,     tick - 0.5, 0);
        draw(trimX,        trimY + H + 0.5, 0, tick - 0.5);
        draw(trimX + W + 0.5, trimY + H,  tick - 0.5, 0);
        draw(trimX + W,    trimY + H + 0.5, 0, tick - 0.5);
      }

      // 7. Barcode — last so nothing overlaps it
      const eanNorm = window.BARCODE.normalizeEan13(state.ean13);
      if (eanNorm.ok) {
        const barY = trimY + H - PAD_Y - state.barcodeHeightMm - 3.5;
        await window.BARCODE.drawToPdf(pdf, {
          digits:      eanNorm.digits,
          x:           barcodeX,
          y:           barY,
          xDimMm:      state.barcodeXDimMm,
          heightMm:    state.barcodeHeightMm,
          includeText: true,
        });
      }
    },
  };

  // ───── Stub modules (commit 2 + 3 will flesh these out) ────────────
  // Listed so the picker can show them as "coming soon" with the same
  // Thumbnail visual language. `available: false` greys them in the
  // picker and disables selection. Selecting them is a no-op until
  // their Preview + drawPdf land.
  // ───── Ruled template ──────────────────────────────────────────────
  // Boxed carton-label look. Thin outer frame; header band with a rule
  // under it; body split into a rows cell (60% of inner width) and an
  // icons cell (40%) by a vertical rule; barcode in its own ruled
  // bottom band, right-aligned. Industrial / traditional.
  //
  // All measurements in mm. The CSS layout (.sm-tpl-ruled in the
  // HTML) and the drawPdf coordinates use the same constants so
  // preview and PDF stay locked together.
  const RULED = {
    frame:        0.30,   // outer-frame stroke (mm)
    rule:         0.25,   // internal divider strokes
    headerH:      11,     // header band height
    footerHPad:   3,      // extra mm above + below the barcode in the footer
    cellPadX:     4,      // horizontal padding inside each cell
    cellPadY:     3,      // vertical padding inside each cell
    rowsCellFrac: 0.60,   // left cell takes 60% of inner width
  };

  // Compute the Ruled geometry — used by both Preview (via CSS
  // variables) and drawPdf so they stay in lockstep.
  function ruledGeometryMm(state) {
    const W = state.widthMm || 130;
    const H = state.heightMm || 90;
    const innerW = W - RULED.frame * 2;
    const footerH = (state.barcodeHeightMm || 20) + 3.5 + RULED.footerHPad * 2;
    const bodyTopY    = RULED.frame + RULED.headerH;
    const bodyBottomY = H - RULED.frame - footerH;
    const bodyH       = Math.max(0, bodyBottomY - bodyTopY);
    const rowsCellW   = innerW * RULED.rowsCellFrac;
    const iconsCellW  = innerW - rowsCellW;
    return {
      W, H, innerW, footerH, bodyTopY, bodyBottomY, bodyH,
      rowsCellW, iconsCellW,
      iconsCellX: RULED.frame + rowsCellW,   // x of the vertical divider
      footerY:    H - RULED.frame - footerH, // y of the footer rule
    };
  }

  const Ruled = {
    id:    "ruled",
    label: "Ruled",
    blurb: "Bordered, ruled grid of boxes — industrial carton-label look.",
    available: true,

    Thumbnail() {
      return h("svg", { viewBox: "0 0 60 42", "aria-hidden": "true" },
        h("rect", { x: 1, y: 1, width: 58, height: 40, rx: 2,
                    fill: "none", stroke: "currentColor", strokeWidth: 1.2 }),
        h("line", { x1: 1, y1: 11, x2: 59, y2: 11, stroke: "currentColor", strokeWidth: 0.7 }),
        h("line", { x1: 36, y1: 11, x2: 36, y2: 32, stroke: "currentColor", strokeWidth: 0.7 }),
        h("line", { x1: 1, y1: 32, x2: 59, y2: 32, stroke: "currentColor", strokeWidth: 0.7 }),
        h("rect", { x: 5, y: 5, width: 14, height: 3, fill: "currentColor", opacity: 0.85 }),
        h("rect", { x: 5, y: 16, width: 22, height: 1.4, fill: "currentColor", opacity: 0.55 }),
        h("rect", { x: 5, y: 20, width: 18, height: 1.4, fill: "currentColor", opacity: 0.55 }),
        h("rect", { x: 5, y: 24, width: 20, height: 1.4, fill: "currentColor", opacity: 0.55 }),
        h("rect", { x: 40, y: 14, width: 6, height: 6, fill: "currentColor", opacity: 0.7 }),
        h("rect", { x: 48, y: 14, width: 6, height: 6, fill: "currentColor", opacity: 0.7 }),
        h("rect", { x: 40, y: 22, width: 6, height: 6, fill: "currentColor", opacity: 0.7 }),
        h("g", { transform: "translate(36, 35)" },
          h("rect", { width: 1, height: 4, fill: "currentColor" }),
          h("rect", { x: 2, width: 1.5, height: 4, fill: "currentColor" }),
          h("rect", { x: 5, width: 0.8, height: 4, fill: "currentColor" }),
          h("rect", { x: 7, width: 1.2, height: 4, fill: "currentColor" }),
          h("rect", { x: 9.5, width: 1, height: 4, fill: "currentColor" }),
          h("rect", { x: 11.5, width: 1.6, height: 4, fill: "currentColor" }),
          h("rect", { x: 14, width: 1, height: 4, fill: "currentColor" }),
          h("rect", { x: 16, width: 1.2, height: 4, fill: "currentColor" }),
          h("rect", { x: 18, width: 1, height: 4, fill: "currentColor" }),
          h("rect", { x: 20, width: 1.4, height: 4, fill: "currentColor" }),
        ),
      );
    },

    // Icons region = the right cell of the body, minus its padding.
    // Used for icon packing + overflow detection.
    iconsRegionMm(state) {
      const g = ruledGeometryMm(state);
      return {
        availH: Math.max(0, g.bodyH - RULED.cellPadY * 2),
        availW: Math.max(0, g.iconsCellW - RULED.cellPadX * 2),
      };
    },

    Preview({ state, ctx }) {
      const { BrandLogo, Editable, BarcodeView,
              setTweak, setRow, removeRow, addRow,
              rowAddBlocked, enabledIcons, sizeFor, getIconMeta } = ctx;
      const t = state;
      const g = ruledGeometryMm(t);
      // Push the Ruled geometry into CSS variables so the .sm-tpl-ruled
      // rules can size cells in mm exactly matching the PDF render.
      const style = {
        "--ruled-header-h-mm":  RULED.headerH,
        "--ruled-footer-h-mm":  g.footerH,
        "--ruled-rows-w-mm":    g.rowsCellW,
        "--ruled-icons-w-mm":   g.iconsCellW,
        "--ruled-frame-mm":     RULED.frame,
        "--ruled-rule-mm":      RULED.rule,
        "--ruled-cell-pad-x-mm": RULED.cellPadX,
        "--ruled-cell-pad-y-mm": RULED.cellPadY,
      };
      return h("div", { className: "sm-trim sm-tpl-ruled", style },
        h("div", { className: "sm-r-header" },
          h(BrandLogo, { src: t.brandLogo, bw: t.brandLogoBw }),
          h(Editable, {
            className: "sm-brand",
            value: t.brandName,
            onChange: (v) => setTweak("brandName", v),
            placeholder: "BRAND",
          }),
        ),
        h("div", { className: "sm-r-body" },
          h("div", { className: "sm-r-rows" },
            (t.rows || []).map((r, i) =>
              h("div", { key: i, className: "sm-row" },
                h(Editable, {
                  className: "sm-row-label",
                  value: r.label,
                  onChange: (v) => setRow(i, { ...r, label: v }),
                  placeholder: "Label",
                }),
                h(Editable, {
                  className: "sm-row-value",
                  value: r.value,
                  onChange: (v) => setRow(i, { ...r, value: v }),
                  placeholder: "Value",
                }),
                h("button", {
                  className: "sm-row-remove",
                  onClick: () => removeRow(i),
                  title: "Remove row",
                }, "×"),
              ),
            ),
            h("button", {
              className: "sm-row-add",
              onClick: addRow,
              disabled: rowAddBlocked,
              title: rowAddBlocked
                ? "No more room — make the card taller or remove a row first."
                : "Add a row",
            }, "+ Add row"),
          ),
          h("div", { className: "sm-r-icons" },
            enabledIcons.map((k) => {
              const meta = getIconMeta(k, t.customIcons);
              if (!meta) return null;
              const sz = sizeFor(k, t);
              return h("div", {
                key: k,
                className: "sm-icon",
                "data-key": k,
                title: `${meta.label} (${sz}mm)`,
                style: { width: `${sz}mm`, height: `${sz}mm` },
              },
                meta.svg
                  ? meta.svg
                  : h("span", {
                      style: { width: "100%", height: "100%", display: "grid", placeItems: "center" },
                      dangerouslySetInnerHTML: { __html: meta.svgString || "" },
                    }),
              );
            }),
          ),
        ),
        h("div", { className: "sm-r-footer" },
          // Reuses the .sm-barcode class but Ruled CSS overrides
          // its absolute positioning so the SVG sits naturally
          // inside the right-aligned footer cell.
          h("div", { className: "sm-barcode sm-r-barcode" },
            h(BarcodeView, {
              digits: t.ean13,
              heightMm: t.barcodeHeightMm,
              xDimMm: t.barcodeXDimMm,
            }),
          ),
        ),
      );
    },

    async drawPdf(pdf, state, ctx) {
      const { logoToBlackPng, packIcons, ICON_ORDER } = ctx;
      const W = state.widthMm, H = state.heightMm, B = state.bleedMm || 0;
      const trimX = B, trimY = B;
      const setBlackText   = () => pdf.setTextColor(0, 0, 0, 1);
      const setBlackStroke = () => pdf.setDrawColor(0, 0, 0, 1);

      const g = ruledGeometryMm(state);

      // 1. Outer frame
      setBlackStroke();
      pdf.setLineWidth(RULED.frame);
      pdf.rect(trimX + RULED.frame / 2, trimY + RULED.frame / 2,
               W - RULED.frame, H - RULED.frame);

      // 2. Header bottom rule + footer top rule + vertical body divider
      pdf.setLineWidth(RULED.rule);
      // header rule
      pdf.line(trimX + RULED.frame,     trimY + g.bodyTopY,
               trimX + W - RULED.frame, trimY + g.bodyTopY);
      // footer rule
      pdf.line(trimX + RULED.frame,     trimY + g.footerY,
               trimX + W - RULED.frame, trimY + g.footerY);
      // vertical divider between rows + icons cells
      pdf.line(trimX + g.iconsCellX, trimY + g.bodyTopY,
               trimX + g.iconsCellX, trimY + g.footerY);

      // 3. Header cell — logo (left) + brand name (right of logo).
      //    Centred vertically inside the header band.
      const headerInnerY = trimY + RULED.frame;
      const headerInnerH = g.bodyTopY - RULED.frame * 2;
      let brandLeftX = trimX + RULED.frame + RULED.cellPadX;
      if (state.brandLogo) {
        try {
          const src = state.brandLogoBw ? await logoToBlackPng(state.brandLogo) : state.brandLogo;
          const probe = await new Promise((res, rej) => {
            const im = new Image();
            im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
            im.onerror = rej;
            im.src = src;
          });
          const aspect = probe.w / probe.h;
          const LOGO_MAX_H = Math.min(8, headerInnerH);
          const LOGO_MAX_W = 30;
          let lh = LOGO_MAX_H, lw = lh * aspect;
          if (lw > LOGO_MAX_W) { lw = LOGO_MAX_W; lh = lw / aspect; }
          const logoY = headerInnerY + (headerInnerH - lh) / 2;
          pdf.addImage(src, "PNG", brandLeftX, logoY, lw, lh, undefined, "FAST");
          brandLeftX += lw + 3;
        } catch (e) {
          console.warn("Logo embed failed:", e);
        }
      }
      if (state.brandName) {
        setBlackText();
        pdf.setFont("Helvetica", "bold");
        const sizeMm = 4.2;
        pdf.setFontSize(sizeMm * 2.83465);
        const baseY = headerInnerY + headerInnerH / 2 + sizeMm * 0.32;
        pdf.text(state.brandName, brandLeftX, baseY);
      }

      // 4. Rows cell — text rows inside the left body cell.
      const rowsX0 = trimX + RULED.frame + RULED.cellPadX;
      const rowsY0 = trimY + g.bodyTopY + RULED.cellPadY;
      const rowsXLimit = trimX + g.iconsCellX - RULED.cellPadX;
      const rowSizeMm = state.rowTextSizeMm || 2.6;
      const rowGapMm  = 0.8;
      const rowLineH  = rowSizeMm * 1.25;
      setBlackText();
      pdf.setFontSize(rowSizeMm * 2.83465);
      let rowY = rowsY0 + rowSizeMm * 0.85;
      const rows = state.rows || [];
      pdf.setFont("Helvetica", "bold");
      let maxLabelW = 0;
      rows.forEach(r => {
        if (!r.label) return;
        const w = pdf.getTextWidth(r.label + ":");
        if (w > maxLabelW) maxLabelW = w;
      });
      const valueX = rowsX0 + maxLabelW + 1.5;
      rows.forEach(r => {
        if (!r.label && !r.value) return;
        pdf.setFont("Helvetica", "bold");
        if (r.label) pdf.text(r.label + ":", rowsX0, rowY);
        pdf.setFont("Helvetica", "normal");
        if (r.value) {
          const maxW = Math.max(10, rowsXLimit - valueX);
          const lines = pdf.splitTextToSize(r.value, maxW);
          pdf.text(lines, valueX, rowY);
          rowY += (lines.length - 1) * rowLineH;
        }
        rowY += rowLineH + rowGapMm;
      });

      // 5. Icons cell — same svg2pdf approach as Classic but packed
      //    into the right cell instead of the right edge of body.
      const enabledIcons = [
        ...ICON_ORDER.filter(k => state.icons && state.icons[k]),
        ...(state.customIcons || []).filter(c => state.icons && state.icons[c.key]).map(c => c.key),
      ];
      if (enabledIcons.length && typeof pdf.svg === "function") {
        const ICON_GAP = 2;
        const region = Ruled.iconsRegionMm(state);
        const packed = packIcons(enabledIcons, state, ICON_GAP, region.availW);
        const card = document.querySelector(".shipping-mark");
        const svgByKey = {};
        if (card) {
          card.querySelectorAll(".sm-icon[data-key]").forEach(el => {
            const key = el.getAttribute("data-key");
            const svg = el.querySelector("svg");
            if (key && svg) svgByKey[key] = svg;
          });
        }
        const iconsX0 = trimX + g.iconsCellX + RULED.cellPadX;
        const iconsY0 = trimY + g.bodyTopY + RULED.cellPadY;
        for (const { key, x, y, sz } of packed.placements) {
          const src = svgByKey[key];
          if (!src) continue;
          const cloned = src.cloneNode(true);
          cloned.querySelectorAll("[fill]").forEach((el) => {
            const f = el.getAttribute("fill");
            if (f === "currentColor") el.setAttribute("fill", "#000");
          });
          cloned.querySelectorAll("[stroke]").forEach((el) => {
            const s = el.getAttribute("stroke");
            if (s === "currentColor") el.setAttribute("stroke", "#000");
          });
          const holder = document.createElement("div");
          holder.style.cssText = "position:absolute;left:-99999px;top:-99999px;pointer-events:none;";
          holder.appendChild(cloned);
          document.body.appendChild(holder);
          try {
            await pdf.svg(cloned, {
              x: iconsX0 + x,
              y: iconsY0 + y,
              width: sz,
              height: sz,
            });
          } catch (err) {
            console.warn("Icon", key, "failed to render via svg2pdf:", err);
          } finally {
            document.body.removeChild(holder);
          }
        }
      }

      // 6. Crop marks (corner ticks in the bleed)
      if (state.showCropMarks && B > 0) {
        setBlackStroke();
        pdf.setLineWidth(0.15);
        const tick = Math.min(3, B);
        const draw = (x, y, dx, dy) => pdf.line(x, y, x + dx, y + dy);
        draw(trimX - tick, trimY,           tick - 0.5, 0);
        draw(trimX,        trimY - tick,    0, tick - 0.5);
        draw(trimX + W + 0.5, trimY,        tick - 0.5, 0);
        draw(trimX + W,    trimY - tick,    0, tick - 0.5);
        draw(trimX - tick, trimY + H,       tick - 0.5, 0);
        draw(trimX,        trimY + H + 0.5, 0, tick - 0.5);
        draw(trimX + W + 0.5, trimY + H,    tick - 0.5, 0);
        draw(trimX + W,    trimY + H + 0.5, 0, tick - 0.5);
      }

      // 7. Barcode — right-aligned in footer cell, last so nothing overlaps it
      const eanNorm = window.BARCODE.normalizeEan13(state.ean13);
      if (eanNorm.ok) {
        const eanW = window.BARCODE.widthMm({ xDimMm: state.barcodeXDimMm });
        const barcodeX = trimX + W - RULED.frame - RULED.cellPadX - eanW;
        const barcodeY = trimY + g.footerY + RULED.footerHPad;
        await window.BARCODE.drawToPdf(pdf, {
          digits: eanNorm.digits,
          x: barcodeX,
          y: barcodeY,
          xDimMm: state.barcodeXDimMm,
          heightMm: state.barcodeHeightMm,
          includeText: true,
        });
      }
    },
  };

  // ───── Stacked template ────────────────────────────────────────────
  // Centred horizontal bands — modern poster look. Brand centred at
  // top, thin divider rule, handling icons as a centred strip (gets
  // prominence), thin divider rule, content rows centred, barcode
  // centred at the bottom. Icons-forward, full-width treatment.
  const STACKED = {
    padX:       5,    // outer padding (mm)
    padY:       5,
    brandH:     12,   // brand band height
    bandGap:    2.5,  // gap above/below each divider rule
    rule:       0.25, // divider stroke
    iconsGapH:  2,    // horizontal gap between icons in the strip
    iconsGapV:  2,    // vertical gap when icons wrap to multiple rows
  };

  function stackedGeometryMm(state) {
    const W = state.widthMm  || 130;
    const H = state.heightMm || 90;
    const innerW = W - STACKED.padX * 2;
    // Vertical bands (y from 0 at trim top, mm):
    //   padY
    //   brandBand (height brandH)
    //   bandGap
    //   rule 1
    //   bandGap
    //   iconsBand (auto height, computed from wrap)
    //   bandGap
    //   rule 2
    //   bandGap
    //   rowsBand (auto height)
    //   barcode (auto height)
    //   padY
    const brandY0    = STACKED.padY;
    const brandY1    = brandY0 + STACKED.brandH;
    const rule1Y     = brandY1 + STACKED.bandGap;
    const iconsY0    = rule1Y  + STACKED.bandGap;
    // Barcode anchored at bottom. Footer height includes HRI digits (~3.5 mm).
    const barcodeH   = (state.barcodeHeightMm || 20) + 3.5;
    const barcodeY1  = H - STACKED.padY;
    const barcodeY0  = barcodeY1 - barcodeH;
    return {
      W, H, innerW, brandY0, brandY1, rule1Y, iconsY0,
      barcodeY0, barcodeY1, barcodeH,
    };
  }

  const Stacked = {
    id:    "stacked",
    label: "Stacked",
    blurb: "Centred bands — modern poster look with icons in the middle.",
    available: true,

    Thumbnail() {
      return h("svg", { viewBox: "0 0 60 42", "aria-hidden": "true" },
        h("rect", { x: 0.5, y: 0.5, width: 59, height: 41, rx: 3,
                    fill: "none", stroke: "currentColor", strokeWidth: 1, opacity: 0.4 }),
        h("rect", { x: 22, y: 5, width: 16, height: 3, fill: "currentColor", opacity: 0.85 }),
        h("line", { x1: 8, y1: 11, x2: 52, y2: 11, stroke: "currentColor", strokeWidth: 0.6, opacity: 0.55 }),
        h("rect", { x: 16, y: 14, width: 5, height: 5, fill: "currentColor", opacity: 0.7 }),
        h("rect", { x: 23, y: 14, width: 5, height: 5, fill: "currentColor", opacity: 0.7 }),
        h("rect", { x: 30, y: 14, width: 5, height: 5, fill: "currentColor", opacity: 0.7 }),
        h("rect", { x: 37, y: 14, width: 5, height: 5, fill: "currentColor", opacity: 0.7 }),
        h("line", { x1: 8, y1: 22, x2: 52, y2: 22, stroke: "currentColor", strokeWidth: 0.6, opacity: 0.55 }),
        h("rect", { x: 20, y: 25, width: 20, height: 1.3, fill: "currentColor", opacity: 0.55 }),
        h("rect", { x: 22, y: 28.5, width: 16, height: 1.3, fill: "currentColor", opacity: 0.55 }),
        h("g", { transform: "translate(22, 33.5)" },
          h("rect", { width: 1, height: 5, fill: "currentColor" }),
          h("rect", { x: 2, width: 1.5, height: 5, fill: "currentColor" }),
          h("rect", { x: 5, width: 0.8, height: 5, fill: "currentColor" }),
          h("rect", { x: 7, width: 1.2, height: 5, fill: "currentColor" }),
          h("rect", { x: 9.5, width: 1, height: 5, fill: "currentColor" }),
          h("rect", { x: 11.5, width: 1.6, height: 5, fill: "currentColor" }),
          h("rect", { x: 14, width: 1, height: 5, fill: "currentColor" }),
          h("rect", { x: 16, width: 1.2, height: 5, fill: "currentColor" }),
        ),
      );
    },

    // Icons get the full inner width as a horizontal strip. The
    // vertical room is whatever's left between rule1 and the rows /
    // barcode below — but for v1 we cap at ~2 icon rows so overflow
    // detection trips before the strip eats the rows band.
    iconsRegionMm(state) {
      const g = stackedGeometryMm(state);
      const iconRowMaxH = (state.iconSizeMm || 14) * 2 + STACKED.iconsGapV;
      return {
        availH: Math.max(0, iconRowMaxH),
        availW: Math.max(0, g.innerW),
      };
    },

    Preview({ state, ctx }) {
      const { BrandLogo, Editable, BarcodeView,
              setTweak, setRow, removeRow, addRow,
              rowAddBlocked, enabledIcons, sizeFor, getIconMeta } = ctx;
      const t = state;
      // The Stacked CSS layout is mostly self-describing (flex bands +
      // dividers), so we don't need to push geometry vars — the bands
      // size themselves to their content + the grid does the rest.
      return h("div", { className: "sm-trim sm-tpl-stacked" },
        h("div", { className: "sm-s-brand" },
          h(BrandLogo, { src: t.brandLogo, bw: t.brandLogoBw }),
          h(Editable, {
            className: "sm-brand",
            value: t.brandName,
            onChange: (v) => setTweak("brandName", v),
            placeholder: "BRAND",
          }),
        ),
        h("hr", { className: "sm-s-rule" }),
        h("div", { className: "sm-s-icons" },
          enabledIcons.map((k) => {
            const meta = getIconMeta(k, t.customIcons);
            if (!meta) return null;
            const sz = sizeFor(k, t);
            return h("div", {
              key: k,
              className: "sm-icon",
              "data-key": k,
              title: `${meta.label} (${sz}mm)`,
              style: { width: `${sz}mm`, height: `${sz}mm` },
            },
              meta.svg
                ? meta.svg
                : h("span", {
                    style: { width: "100%", height: "100%", display: "grid", placeItems: "center" },
                    dangerouslySetInnerHTML: { __html: meta.svgString || "" },
                  }),
            );
          }),
        ),
        h("hr", { className: "sm-s-rule" }),
        h("div", { className: "sm-s-rows" },
          (t.rows || []).map((r, i) =>
            h("div", { key: i, className: "sm-row" },
              h(Editable, {
                className: "sm-row-label",
                value: r.label,
                onChange: (v) => setRow(i, { ...r, label: v }),
                placeholder: "Label",
              }),
              h(Editable, {
                className: "sm-row-value",
                value: r.value,
                onChange: (v) => setRow(i, { ...r, value: v }),
                placeholder: "Value",
              }),
              h("button", {
                className: "sm-row-remove",
                onClick: () => removeRow(i),
                title: "Remove row",
              }, "×"),
            ),
          ),
          h("button", {
            className: "sm-row-add",
            onClick: addRow,
            disabled: rowAddBlocked,
            title: rowAddBlocked
              ? "No more room — make the card taller or remove a row first."
              : "Add a row",
          }, "+ Add row"),
        ),
        h("div", { className: "sm-barcode sm-s-barcode" },
          h(BarcodeView, {
            digits: t.ean13,
            heightMm: t.barcodeHeightMm,
            xDimMm: t.barcodeXDimMm,
          }),
        ),
      );
    },

    async drawPdf(pdf, state, ctx) {
      const { logoToBlackPng, packIcons, ICON_ORDER } = ctx;
      const W = state.widthMm, H = state.heightMm, B = state.bleedMm || 0;
      const trimX = B, trimY = B;
      const setBlackText   = () => pdf.setTextColor(0, 0, 0, 1);
      const setBlackStroke = () => pdf.setDrawColor(0, 0, 0, 1);

      const g = stackedGeometryMm(state);

      // 1. Brand band — logo + name CENTRED horizontally inside the
      //    brand band. We measure both and emit them as a unit so the
      //    composite stays centred no matter the logo/name widths.
      let logoBitmap = null;
      let logoW = 0, logoH = 0;
      if (state.brandLogo) {
        try {
          const src = state.brandLogoBw ? await logoToBlackPng(state.brandLogo) : state.brandLogo;
          const probe = await new Promise((res, rej) => {
            const im = new Image();
            im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
            im.onerror = rej;
            im.src = src;
          });
          const aspect = probe.w / probe.h;
          const LOGO_MAX_H = Math.min(STACKED.brandH - 2, 10);
          const LOGO_MAX_W = 30;
          let lh = LOGO_MAX_H, lw = lh * aspect;
          if (lw > LOGO_MAX_W) { lw = LOGO_MAX_W; lh = lw / aspect; }
          logoBitmap = src;
          logoW = lw; logoH = lh;
        } catch (e) {
          console.warn("Logo embed failed:", e);
        }
      }
      let nameW = 0;
      const nameSizeMm = 4.6;
      if (state.brandName) {
        pdf.setFont("Helvetica", "bold");
        pdf.setFontSize(nameSizeMm * 2.83465);
        nameW = pdf.getTextWidth(state.brandName);
      }
      const logoNameGap = (logoW > 0 && nameW > 0) ? 3 : 0;
      const composite = logoW + logoNameGap + nameW;
      const brandX0 = trimX + (W - composite) / 2;
      const brandMidY = trimY + g.brandY0 + STACKED.brandH / 2;
      if (logoBitmap) {
        pdf.addImage(logoBitmap, "PNG", brandX0, brandMidY - logoH / 2,
                     logoW, logoH, undefined, "FAST");
      }
      if (state.brandName) {
        setBlackText();
        pdf.setFont("Helvetica", "bold");
        pdf.setFontSize(nameSizeMm * 2.83465);
        const nameBaselineY = brandMidY + nameSizeMm * 0.32;
        pdf.text(state.brandName, brandX0 + logoW + logoNameGap, nameBaselineY);
      }

      // 2. Divider rule 1 (under brand)
      setBlackStroke();
      pdf.setLineWidth(STACKED.rule);
      pdf.line(trimX + STACKED.padX, trimY + g.rule1Y,
               trimX + W - STACKED.padX, trimY + g.rule1Y);

      // 3. Icons strip — centred horizontally, may wrap into rows.
      const enabledIcons = [
        ...ICON_ORDER.filter(k => state.icons && state.icons[k]),
        ...(state.customIcons || []).filter(c => state.icons && state.icons[c.key]).map(c => c.key),
      ];
      let iconsBlockH = 0;
      let iconsBottomY = trimY + g.iconsY0;
      if (enabledIcons.length && typeof pdf.svg === "function") {
        const region = Stacked.iconsRegionMm(state);
        const packed = packIcons(enabledIcons, state, STACKED.iconsGapH, region.availW);
        iconsBlockH = packed.totalH;
        // Centre the packed block horizontally inside the card.
        const iconsLeftX = trimX + (W - packed.totalW) / 2;
        const iconsTopY  = trimY + g.iconsY0;
        const card = document.querySelector(".shipping-mark");
        const svgByKey = {};
        if (card) {
          card.querySelectorAll(".sm-icon[data-key]").forEach(el => {
            const key = el.getAttribute("data-key");
            const svg = el.querySelector("svg");
            if (key && svg) svgByKey[key] = svg;
          });
        }
        for (const { key, x, y, sz } of packed.placements) {
          const src = svgByKey[key];
          if (!src) continue;
          const cloned = src.cloneNode(true);
          cloned.querySelectorAll("[fill]").forEach((el) => {
            const f = el.getAttribute("fill");
            if (f === "currentColor") el.setAttribute("fill", "#000");
          });
          cloned.querySelectorAll("[stroke]").forEach((el) => {
            const s = el.getAttribute("stroke");
            if (s === "currentColor") el.setAttribute("stroke", "#000");
          });
          const holder = document.createElement("div");
          holder.style.cssText = "position:absolute;left:-99999px;top:-99999px;pointer-events:none;";
          holder.appendChild(cloned);
          document.body.appendChild(holder);
          try {
            await pdf.svg(cloned, {
              x: iconsLeftX + x,
              y: iconsTopY + y,
              width: sz,
              height: sz,
            });
          } catch (err) {
            console.warn("Icon", key, "failed to render via svg2pdf:", err);
          } finally {
            document.body.removeChild(holder);
          }
        }
        iconsBottomY = iconsTopY + iconsBlockH;
      }

      // 4. Divider rule 2 (under icons)
      const rule2Y = iconsBottomY + STACKED.bandGap;
      pdf.setLineWidth(STACKED.rule);
      setBlackStroke();
      pdf.line(trimX + STACKED.padX, trimY + (rule2Y - trimY),
               trimX + W - STACKED.padX, trimY + (rule2Y - trimY));

      // 5. Rows — each row centred horizontally. We measure
      //    label + value text widths per row to centre each.
      const rowSizeMm = state.rowTextSizeMm || 2.6;
      const rowGapMm  = 0.8;
      const rowLineH  = rowSizeMm * 1.25;
      const labelValueGap = 1.5;
      setBlackText();
      pdf.setFontSize(rowSizeMm * 2.83465);
      let rowY = rule2Y + STACKED.bandGap + rowSizeMm * 0.85;
      const rowsBottomLimit = trimY + g.barcodeY0 - STACKED.bandGap;
      const rows = state.rows || [];
      rows.forEach(r => {
        if (!r.label && !r.value) return;
        if (rowY > rowsBottomLimit) return;  // out of room — preview shows overflow warning
        pdf.setFont("Helvetica", "bold");
        const labelText = r.label ? r.label + ":" : "";
        const labelW = labelText ? pdf.getTextWidth(labelText) : 0;
        pdf.setFont("Helvetica", "normal");
        const valueW = r.value ? pdf.getTextWidth(r.value) : 0;
        const lineGap = (labelW > 0 && valueW > 0) ? labelValueGap : 0;
        const totalW = labelW + lineGap + valueW;
        const startX = trimX + (W - totalW) / 2;
        if (labelText) {
          pdf.setFont("Helvetica", "bold");
          pdf.text(labelText, startX, rowY);
        }
        if (r.value) {
          pdf.setFont("Helvetica", "normal");
          pdf.text(r.value, startX + labelW + lineGap, rowY);
        }
        rowY += rowLineH + rowGapMm;
      });

      // 6. Barcode — centred horizontally at the bottom
      const eanNorm = window.BARCODE.normalizeEan13(state.ean13);
      if (eanNorm.ok) {
        const eanW = window.BARCODE.widthMm({ xDimMm: state.barcodeXDimMm });
        const barcodeX = trimX + (W - eanW) / 2;
        await window.BARCODE.drawToPdf(pdf, {
          digits: eanNorm.digits,
          x: barcodeX,
          y: trimY + g.barcodeY0,
          xDimMm: state.barcodeXDimMm,
          heightMm: state.barcodeHeightMm,
          includeText: true,
        });
      }

      // 7. Crop marks (corner ticks in the bleed)
      if (state.showCropMarks && B > 0) {
        setBlackStroke();
        pdf.setLineWidth(0.15);
        const tick = Math.min(3, B);
        const draw = (x, y, dx, dy) => pdf.line(x, y, x + dx, y + dy);
        draw(trimX - tick, trimY,           tick - 0.5, 0);
        draw(trimX,        trimY - tick,    0, tick - 0.5);
        draw(trimX + W + 0.5, trimY,        tick - 0.5, 0);
        draw(trimX + W,    trimY - tick,    0, tick - 0.5);
        draw(trimX - tick, trimY + H,       tick - 0.5, 0);
        draw(trimX,        trimY + H + 0.5, 0, tick - 0.5);
        draw(trimX + W + 0.5, trimY + H,    tick - 0.5, 0);
        draw(trimX + W,    trimY + H + 0.5, 0, tick - 0.5);
      }
    },
  };

  // Picker order — left-to-right in the Tweaks panel.
  window.TEMPLATE_LIST = [Classic, Ruled, Stacked];
  window.TEMPLATES = {
    classic: Classic,
    ruled:   Ruled,
    stacked: Stacked,
  };
  // Helper: resolve the active template, falling back to Classic if the
  // saved state references a template id we no longer ship (e.g. a
  // future-build preset loaded into an older deploy).
  window.activeTemplate = function (state) {
    const id = (state && state.template) || "classic";
    return window.TEMPLATES[id] || window.TEMPLATES.classic;
  };
})();
