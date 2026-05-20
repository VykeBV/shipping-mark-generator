// app.jsx — Shipping Mark Generator. Sister to the Vyke Create Data Sheet
// creator: same dark Tweaks panel, same live-preview-with-PDF-export workflow,
// but tuned for printing rectangular shipping marks / ex-marks / export-carton
// labels with vector-precise EAN-13 barcodes, ISO 780 handling icons,
// freely-addable text rows, customer logo (with optional B&W threshold),
// configurable bleed and crop marks.

const { useState, useEffect, useRef, useCallback } = React;

// ─── Defaults (editable via Tweaks; persisted to localStorage on change) ─────
// Kept generic so the tool is a true template — labels are hints, values are
// empty. Users add/remove/rename rows freely (every label and value is
// click-to-edit, and the Tweaks panel exposes add/remove buttons).
const DEFAULTS = {
  widthMm: 130,
  heightMm: 90,
  bleedMm: 3,
  showCropMarks: true,
  showTrimGuide: true,

  brandName: "",          // placeholder "BRAND NAME" shows until filled
  brandLogo: null,        // dataURL
  brandLogoBw: false,

  rows: [
    { label: "Product Code", value: "" },
    { label: "Description", value: "" },
    { label: "Case Size", value: "" },
    { label: "Gross Weight (kg)", value: "" },
    { label: "Country", value: "" },
  ],
  // Row text size in mm. Default 2.6 mm matches typical retail
  // shipping-mark text. Adjustable via the Advanced panel slider.
  rowTextSizeMm: 2.6,
  // Display unit for size fields (W / H / Bleed). Internally everything
  // is stored in mm (so layout, PDF render, presets are unit-stable);
  // this only affects how numbers are SHOWN and entered. One of:
  // "mm" | "cm" | "in".
  sizeUnit: "mm",

  ean13: "1234567890128",  // canonical placeholder EAN-13 (valid check digit)
  barcodeHeightMm: 20,
  // GS1 100 % magnification (0.330 mm) — significantly more scannable on
  // consumer printers than the 0.264 mm absolute minimum. Range still
  // 0.264 mm – 0.660 mm via the Advanced panel.
  barcodeXDimMm: 0.330,

  icons: {
    this_way_up: true,
    fragile: false,
    keep_dry: false,
    no_stack: false,
    stack_limit: false,
    centre_of_gravity: false,
    temp_limits: false,
  },
  iconSizeMm: 14,              // global icon height
  iconSizesMm: {},             // per-icon override map { key: heightMm } — set in the Advanced panel
  customIcons: [],             // user-uploaded SVGs: [{ key, label, svg, isoNormalMm, safeMinMm, defaultMm }]
};

// Built-in icon order in panel toggles + live preview. Custom icons append.
// `handle_with_care` was removed when we switched to the official artwork:
// ISO 7000-0621 "Fragile / Handle With Care" is a single registered symbol,
// not two — they are the same icon in the standard.
const ICON_ORDER = [
  "this_way_up", "fragile", "keep_dry",
  "no_stack", "stack_limit", "centre_of_gravity", "temp_limits",
];

// Resolve an icon's metadata regardless of source (built-in vs uploaded).
function getIconMeta(key, customIcons) {
  if (window.ICON_LIBRARY[key]) return window.ICON_LIBRARY[key];
  return (customIcons || []).find(c => c.key === key) || null;
}

// Resolve the size (mm) to use for a given enabled icon. Per-icon overrides
// (set in the Advanced panel) take precedence; otherwise the global icon
// size applies. Returns 14mm as a final safety fallback.
//
// No auto-clamping: the slider is the user's source of truth. An earlier
// version silently clamped to `iconFitMaxMm` to prevent overflow on tiny
// cards, but that made the slider feel broken at large values. Instead,
// `.sm-trim { overflow: hidden }` clips any preview overflow so the user
// sees exactly what they're getting and can dial it down themselves.
function sizeFor(key, state) {
  const override = state.iconSizesMm && state.iconSizesMm[key];
  return Number.isFinite(override) && override > 0
    ? override
    : (state.iconSizeMm || 14);
}

// How much vertical & horizontal space the icons block has, given the
// current card dimensions. The icons block sits in the right column of
// the body grid; the left column holds the text rows and needs at least
// ~40 mm to stay readable (or 40 % of body width — whichever is larger).
// Whatever's left over after the barcode reservation goes to icons.
//
// Used by:
//   • The CSS `--icons-max-w-mm` variable that gives .sm-icons its
//     dynamic max-width (so wider cards lay out icons in more columns).
//   • The PDF renderer's packIcons() call.
//   • iconsOverflow() to detect when the user's chosen icon size can't
//     fit, so the UI can surface a red warning.
function availableIconsRegionMm(state) {
  const trimPadV = 8;                                       // 4mm top + 4mm bottom of .sm-trim
  const trimPadH = 10;                                      // 5mm left + 5mm right of .sm-trim
  const headerH = 12;                                       // approximate header height
  const headerGap = 2.5;                                    // .sm-trim flex-gap between header and body
  const bodyGap = 4;                                        // .sm-body flex gap between rows and icons
  const barcodeBlockW = window.BARCODE
    ? window.BARCODE.widthMm({ xDimMm: state.barcodeXDimMm || 0.264 }) + 4
    : 36;
  // Icons can use the FULL body height (we no longer subtract the
  // barcode block height): `.sm-body` reserves a horizontal column for
  // the barcode via `padding-right`, so icons (right-anchored) end at
  // the barcode's left edge horizontally and never overlap. They're
  // free to extend all the way down to the body bottom.
  const usableH = (state.heightMm || 90) - trimPadV - headerH - headerGap;
  const bodyW = (state.widthMm || 130) - trimPadH - barcodeBlockW;
  // Content-aware rows column width:
  // - With row content → reserve max(40 mm, 40 % of body) so labels stay readable.
  // - With all rows empty → reserve 0, so icons flex into the freed space.
  //   The CSS `.sm-rows` still naturally takes some width for the "+ Add row"
  //   button (~13 mm) but we let icons claim everything up to the right edge;
  //   any minor overlap is absorbed by the flex layout's auto sizing.
  const hasRowContent = (state.rows || []).some(r =>
    (r && r.label && r.label.trim()) || (r && r.value && r.value.trim())
  );
  const minRowsW = hasRowContent ? Math.max(40, bodyW * 0.40) : 0;
  const usableW = bodyW - minRowsW - bodyGap;
  return {
    availH: Math.max(0, usableH),
    availW: Math.max(0, usableW),
  };
}

// ─── Display unit helpers ─────────────────────────────────────────────
// Everything in state is stored in MM (so the layout calc, PDF render,
// barcode dimensions and presets are unit-stable). The user can choose
// to ENTER and VIEW size fields in millimetres, centimetres, or inches;
// these helpers convert between mm and the chosen display unit.
const UNIT_TO_MM = { mm: 1, cm: 10, in: 25.4 };
const UNIT_DECIMALS = { mm: 1, cm: 2, in: 3 };
const UNIT_STEP    = { mm: 1, cm: 0.1, in: 0.05 };
function mmToUnit(valMm, unit) {
  return valMm / (UNIT_TO_MM[unit] || 1);
}
function unitToMm(val, unit) {
  return val * (UNIT_TO_MM[unit] || 1);
}
function unitLabel(unit) {
  return unit === "in" ? "in" : unit;
}

// ─── Row-fit helpers ──────────────────────────────────────────────────
// Mirror the .sm-row / .sm-rows CSS so JS can decide whether more rows
// will fit. Each row is one line of Roboto at line-height 1.25, stacked
// with 0.8 mm gaps. The "+ Add row" button below takes ~4 mm. Text size
// is user-configurable via state.rowTextSizeMm (default 2.6 mm).
// Approximations — if a row's value wraps to multiple lines, real
// height will exceed our estimate, but the overflow warning will catch
// it once it actually clips.
const ROW_GAP_MM    = 0.8;            // .sm-rows gap
const ADD_BTN_H_MM  = 4.0;            // .sm-row-add approximate height

function rowLineHeightMm(state) {
  return (state.rowTextSizeMm || 2.6) * 1.25;
}

function rowsBlockHeightMm(rowCount, state) {
  if (rowCount <= 0) return ADD_BTN_H_MM;
  const lineH = rowLineHeightMm(state);
  return rowCount * lineH
       + (rowCount - 1) * ROW_GAP_MM
       + ADD_BTN_H_MM
       + 1.5;                          // small breathing room
}

// True when the current N rows + the "+ Add row" button would exceed
// the body's available height (= the same region icons share).
function rowsOverflow(rowCount, state) {
  const availH = availableIconsRegionMm(state).availH;
  return rowsBlockHeightMm(rowCount, state) > availH + 0.01;
}

// True when adding one MORE row would NOT overflow.
function canAddRow(state) {
  const current = (state.rows || []).length;
  return !rowsOverflow(current + 1, state);
}

// True when the user's chosen icon size would overflow the available
// region. Drives the red warning in the Tweaks panel.
function iconsOverflow(enabledKeys, state) {
  if (!enabledKeys || enabledKeys.length === 0) return false;
  const region = availableIconsRegionMm(state);
  if (region.availW <= 0 || region.availH <= 0) return true;
  const packed = packIcons(enabledKeys, state, 2, region.availW);
  return packed.totalW > region.availW + 0.01
      || packed.totalH > region.availH + 0.01;
}

// Pick the biggest icon size that fits all `n` enabled icons inside the
// given (availW × availH) rectangle. Unlike a fixed-column grid, this
// search tries every column count from 1 up to `n` and keeps the largest
// size that still fits both dimensions — so a wide-but-short card (e.g.
// 200 × 40 mm) lays icons out in MORE columns / FEWER rows automatically,
// matching the CSS flex-wrap behaviour of `.sm-icons`. Floor at 3mm; if
// even that doesn't fit, the trim's `overflow: hidden` will clip the
// excess so nothing escapes into the bleed area.
function iconFitMaxMm(n, region, gap = 2) {
  if (n <= 0) return Infinity;
  const { availH, availW } = region;
  if (availW <= 0 || availH <= 0) return 3;
  let best = 0;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    // Largest size that fits horizontally with this column count.
    const wCap = (availW - (cols - 1) * gap) / cols;
    // Largest size that fits vertically with this row count.
    const hCap = (availH - (rows - 1) * gap) / rows;
    const sz = Math.min(wCap, hCap);
    if (sz > best) best = sz;
  }
  // Soft cap at 14mm (above that, an icon larger than the default looks
  // odd) and floor at 3mm (trim clips anything smaller that still
  // overflows — fine for the rare extreme case).
  if (best > 14) return 14;
  if (best < 3) return 3;
  return best;
}

// Pack enabled icons into rows using the same flex-wrap rules as CSS.
// Returns { placements: [{key, x, y, sz}], totalW, totalH }.
//
// `maxW` is the icons block's max usable width in mm — passed in by the
// caller so the live preview (CSS `--icons-max-w-mm`) and the PDF render
// use the exact same wrap point. When omitted, defaults to a permissive
// 200 mm (effectively single-row for typical icon sizes).
function packIcons(enabledKeys, state, gap = 2, maxW = 200) {
  let rowX = 0, rowY = 0, rowH = 0, blockW = 0;
  const placements = [];
  enabledKeys.forEach((k) => {
    const sz = sizeFor(k, state);
    if (rowX > 0 && rowX + sz > maxW) {
      rowY += rowH + gap;
      rowX = 0; rowH = 0;
    }
    placements.push({ key: k, x: rowX, y: rowY, sz });
    rowX += sz + gap;
    rowH = Math.max(rowH, sz);
    blockW = Math.max(blockW, rowX - gap);
  });
  return { placements, totalW: blockW, totalH: rowY + rowH };
}

// ─── Editable text — click to edit inline ─────────────────────────────────────
function Editable({ value, onChange, className, style, multiline, placeholder }) {
  const ref = useRef(null);
  const onBlur = () => {
    const next = ref.current.innerText.trim();
    if (next !== value) onChange(next);
  };
  const onKeyDown = (e) => {
    if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      ref.current.blur();
    }
    if (e.key === "Escape") {
      ref.current.innerText = value;
      ref.current.blur();
    }
  };
  useEffect(() => {
    if (ref.current && ref.current.innerText !== value) {
      ref.current.innerText = value;
    }
  }, [value]);
  return (
    <span
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className={`editable ${className || ""}`}
      style={style}
      data-placeholder={placeholder}
    >
      {value}
    </span>
  );
}

// ─── Barcode preview (SVG via window.BARCODE.toSvg) ───────────────────────────
// While the user types a new EAN, we don't want the preview to blank out and
// flash an error every time the digit count is intermediate (e.g. 7 of 13).
// Instead we remember the LAST valid digits and keep rendering that — dimmed
// to signal "the input doesn't currently match this barcode". Validation
// status is shown separately in the Tweaks panel.
function BarcodeView({ digits, heightMm, xDimMm }) {
  const norm = window.BARCODE.normalizeEan13(digits);
  const lastValidRef = useRef(norm.ok ? norm.digits : null);
  if (norm.ok) lastValidRef.current = norm.digits;

  if (!lastValidRef.current) {
    // No valid value has ever been entered (and the current one is invalid):
    // render a subtle placeholder so the layout doesn't collapse.
    return (
      <div style={{
        font: "400 2.4mm Roboto", color: "#888", padding: "2mm",
        border: "0.2mm dashed #ccc", borderRadius: "1mm",
        minWidth: "30mm", textAlign: "center",
      }}>
        Enter a 12- or 13-digit EAN
      </div>
    );
  }

  const svg = window.BARCODE.toSvg({
    digits: lastValidRef.current, heightMm, xDimMm,
  });
  return (
    <span
      style={{ opacity: norm.ok ? 1 : 0.35, transition: "opacity .12s ease" }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// ─── Logo image (with optional B&W threshold) ─────────────────────────────────
function BrandLogo({ src, bw }) {
  if (!src) return null;
  return (
    <img
      className={`sm-brand-logo ${bw ? "is-bw" : ""}`}
      src={src}
      alt=""
    />
  );
}

// Threshold the logo into pure black-on-transparent for B&W print output.
// Returns a PNG data URL. Pixels with luma < threshold become opaque black.
async function logoToBlackPng(src, threshold = 200) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3];
        // Treat fully-transparent pixels as transparent; otherwise threshold luma.
        if (a < 8) { px[i + 3] = 0; continue; }
        const luma = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        if (luma < threshold) {
          px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 255;
        } else {
          px[i + 3] = 0;
        }
      }
      ctx.putImageData(data, 0, 0);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

// ─── Main App ────────────────────────────────────────────────────────────────
// ─── FeedbackPopover ──────────────────────────────────────────────────────────
// Pitch + textarea + submit. Wraps window.FEEDBACK.submit (feedback.jsx)
// which writes to Supabase when configured or falls back to a
// localStorage ring buffer. Used by the Feedback button in HeaderBar.
function FeedbackPopover({ user, onClose }) {
  const { useState, useRef, useEffect } = React;
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // null | { ok, text, offline? }
  const textRef = useRef(null);
  useEffect(() => { textRef.current && textRef.current.focus(); }, []);
  const submit = async (e) => {
    if (e) e.preventDefault();
    if (!message.trim() || busy) return;
    setBusy(true);
    try {
      const res = await window.FEEDBACK.submit({ message, user });
      if (res.ok) {
        setStatus({
          ok: true,
          text: res.offline
            ? "Saved on this device — we'll pick it up next sync."
            : "Thank you! We read every message.",
          offline: !!res.offline,
        });
        setMessage("");
        setTimeout(onClose, 2200);
      } else {
        setStatus({ ok: false, text: res.error || "Something went wrong — try again?" });
      }
    } catch (err) {
      setStatus({ ok: false, text: err?.message || "Something went wrong — try again?" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="vyke-feedback-pop" role="dialog" aria-label="Send feedback">
      <div className="vyke-feedback-title">Help us build something useful</div>
      <p className="vyke-feedback-pitch">
        We're still developing this tool — let us know what you think and how we
        can improve. Only with your feedback can we create something truly useful.
      </p>
      <form onSubmit={submit}>
        <textarea
          ref={textRef}
          className="vyke-feedback-text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What's working, what's broken, what's missing?"
          rows={5}
          maxLength={4000}
          disabled={busy}
        />
        <div className="vyke-feedback-row">
          <span className="vyke-feedback-meta">
            {user
              ? <>Sending as <b>{user.email}</b></>
              : <>Sending anonymously</>}
          </span>
          <button
            type="submit"
            className="vyke-feedback-send"
            disabled={busy || !message.trim()}
          >
            {busy ? "Sending…" : "Send feedback"}
          </button>
        </div>
        {status && (
          <div
            className={"vyke-feedback-status " + (status.ok ? "is-ok" : "is-err")}
            role={status.ok ? "status" : "alert"}
          >
            {status.text}
          </div>
        )}
      </form>
    </div>
  );
}

// ─── HeaderBar ────────────────────────────────────────────────────────────────
// Top application bar. Holds the Vyke Create logo on the left, then
// (right side, in order) the Presets menu, the Feedback button, the
// Export menu, the account chip. Replaces what used to live inside
// the Tweaks panel header / body so the panel can focus purely on
// document editing.
function HeaderBar({
  user, onSignOut,
  widthMm, heightMm, bleedMm, batchProgress,
  currentState, onApplyState,
  onDownloadPdf, onExportCsv, onImportCsv, onBatchPdf, onResetState,
}) {
  const { useState, useEffect, useRef } = React;
  const [exportOpen, setExportOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const exportRef = useRef(null);
  const presetsRef = useRef(null);
  const feedbackRef = useRef(null);
  // Close any open dropdown on outside-click or Escape.
  useEffect(() => {
    if (!exportOpen && !presetsOpen && !feedbackOpen) return;
    const onDocClick = (e) => {
      if (exportOpen && exportRef.current && !exportRef.current.contains(e.target)) {
        setExportOpen(false);
      }
      if (presetsOpen && presetsRef.current && !presetsRef.current.contains(e.target)) {
        setPresetsOpen(false);
      }
      if (feedbackOpen && feedbackRef.current && !feedbackRef.current.contains(e.target)) {
        setFeedbackOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setExportOpen(false);
        setPresetsOpen(false);
        setFeedbackOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [exportOpen, presetsOpen, feedbackOpen]);
  const closeAll = () => {
    setExportOpen(false);
    setPresetsOpen(false);
    setFeedbackOpen(false);
  };

  const sizeSuffix = bleedMm
    ? `${widthMm} × ${heightMm} mm + ${bleedMm} mm bleed`
    : `${widthMm} × ${heightMm} mm`;
  const pdfLabel = batchProgress
    ? `Generating page ${batchProgress.i} / ${batchProgress.n}…`
    : "Download as PDF";
  const batchLabel = batchProgress
    ? `Batch… ${batchProgress.i}/${batchProgress.n}`
    : "Batch CSV → multi-page PDF";

  const runAndCloseExport = (fn) => () => { setExportOpen(false); fn && fn(); };

  return (
    <header className="vyke-header" role="banner">
      <div className="vyke-header-logo" aria-label="Vyke Create" />
      <div className="vyke-header-spacer" />

      {/* Feedback button — always visible, always discoverable. Opens
          a popover with a short pitch + text area so users can tell
          us what to fix while we're still iterating. */}
      <div className="vyke-export-wrap" ref={feedbackRef}>
        <button
          type="button"
          className="vyke-header-btn vyke-header-btn--feedback"
          onClick={() => { setFeedbackOpen((v) => !v); setExportOpen(false); setPresetsOpen(false); }}
          aria-expanded={feedbackOpen ? "true" : "false"}
          aria-haspopup="dialog"
          title="Share feedback with the Vyke team"
        >
          <svg viewBox="0 0 14 14" aria-hidden="true">
            <path
              fill="none" stroke="currentColor" strokeWidth="1.4"
              strokeLinecap="round" strokeLinejoin="round"
              d="M1.5 3a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7L4 12.5V10H2.5a1 1 0 0 1-1-1V3z"
            />
          </svg>
          Feedback
        </button>
        {feedbackOpen && (
          <FeedbackPopover
            user={user}
            onClose={() => setFeedbackOpen(false)}
          />
        )}
      </div>

      {/* Presets menu — same dropdown pattern as Export. Wraps the
          existing window.PresetsPanel component so all save / load /
          delete logic stays in one place. Only shown when signed in. */}
      {user && window.PresetsPanel && (
        <div className="vyke-export-wrap" ref={presetsRef}>
          <button
            type="button"
            className="vyke-header-btn"
            onClick={() => { setPresetsOpen((v) => !v); setExportOpen(false); setFeedbackOpen(false); }}
            aria-expanded={presetsOpen ? "true" : "false"}
            aria-haspopup="menu"
            title="Save the current setup as a preset, or load one you saved earlier"
          >
            <svg viewBox="0 0 14 14" aria-hidden="true">
              <path
                fill="none" stroke="currentColor" strokeWidth="1.4"
                strokeLinecap="round" strokeLinejoin="round"
                d="M1.5 4.5h11v7a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1v-7z M1.5 4.5l1-2.5h4l1 2 4 .5z"
              />
            </svg>
            Presets
            <svg className="vyke-export-chev" viewBox="0 0 10 6" aria-hidden="true">
              <path fill="currentColor" d="M0 0h10L5 6z" />
            </svg>
          </button>
          <div className="vyke-presets-menu" role="menu" hidden={!presetsOpen}>
            <window.PresetsPanel
              user={user}
              currentState={currentState}
              onApplyState={(state) => { onApplyState(state); setPresetsOpen(false); }}
            />
          </div>
        </div>
      )}

      <div className="vyke-export-wrap" ref={exportRef}>
        <button
          type="button"
          className="vyke-export-trigger"
          onClick={() => { setExportOpen((v) => !v); setPresetsOpen(false); setFeedbackOpen(false); }}
          aria-expanded={exportOpen ? "true" : "false"}
          aria-haspopup="menu"
        >
          <svg viewBox="0 0 14 14" aria-hidden="true">
            <path
              fill="none" stroke="currentColor" strokeWidth="1.4"
              strokeLinecap="round" strokeLinejoin="round"
              d="M7 1v8.5 M3.5 6.5 7 10l3.5-3.5 M2 12.5h10"
            />
          </svg>
          Export
          <svg className="vyke-export-chev" viewBox="0 0 10 6" aria-hidden="true">
            <path fill="currentColor" d="M0 0h10L5 6z" />
          </svg>
        </button>
        <div className="vyke-export-menu" role="menu" hidden={!exportOpen}>
          <button type="button" role="menuitem" className="is-primary"
                  onClick={runAndCloseExport(onDownloadPdf)}>
            <span>
              {pdfLabel}
              <small>{sizeSuffix}</small>
            </span>
          </button>
          <div className="vyke-export-divider" />
          <button type="button" role="menuitem" onClick={runAndCloseExport(onExportCsv)}>
            Export CSV
            <small>Save this mark as one row</small>
          </button>
          <button type="button" role="menuitem" onClick={runAndCloseExport(onImportCsv)}>
            Import CSV
            <small>Load a single row from CSV</small>
          </button>
          <button type="button" role="menuitem" onClick={runAndCloseExport(onBatchPdf)}>
            {batchLabel}
            <small>One page per CSV row</small>
          </button>
          <div className="vyke-export-divider" />
          <button type="button" role="menuitem" onClick={runAndCloseExport(onResetState)}>
            Reset to defaults
          </button>
        </div>
      </div>

      {user && window.AccountChip && (
        <window.AccountChip user={user} onSignOut={onSignOut} />
      )}
    </header>
  );
}

function App() {
  const [t, setTweak] = useTweaks(DEFAULTS);
  // Advanced settings side-panel — opens to the left of the main Tweaks panel.
  // Houses expert-only controls (per-icon sizes, force-logo-black, barcode bar
  // height + X-dimension) so the main panel stays focused on everyday inputs.
  // (Advanced settings are now an inline collapsible section in the
  // sidebar — no separate side-panel state needed.)

  // ── Account / welcome-gate ──────────────────────────────────────────
  // The Welcome overlay locks the editor until the visitor has entered an
  // email. After that the user object (id + email + display_name) lives
  // in localStorage via auth.jsx; we mirror it in React state so the rest
  // of the UI (account chip, presets panel) can re-render on sign in / out.
  const [user, setUser] = useState(() => (window.AUTH ? window.AUTH.getCurrentUser() : null));
  useEffect(() => {
    if (user && window.AUTH) {
      window.AUTH.touchLastSeen(user.id);
      // Fire a single signin event per cold start so the admin can see
      // returning-user activity (signup is fired separately by Welcome).
      window.ACTIVITY && window.ACTIVITY.log("signin", {
        ua: navigator.userAgent.slice(0, 200),
      });
    }
  }, []);  // intentionally once on mount
  // Toggle a body class so CSS can blur+lock the editor behind the modal.
  useEffect(() => {
    document.body.classList.toggle("vyke-locked", !user);
    return () => document.body.classList.remove("vyke-locked");
  }, [user]);

  const handleSignOut = useCallback(() => {
    if (window.AUTH) window.AUTH.clearAccount();
    setUser(null);
  }, []);

  // Apply a saved preset's full state back into the editor. We walk every
  // key on the saved object so legacy presets missing newer fields fall
  // back to current defaults (the missing keys keep their current values).
  const applyPresetState = useCallback((state) => {
    if (!state || typeof state !== "object") return;
    Object.keys(state).forEach((k) => setTweak(k, state[k]));
  }, [setTweak]);

  // Persist all tweak state to localStorage so reloads don't lose work.
  // Bumped to v2 when defaults became a neutral template (was ALDI-specific in v1).
  const STORAGE_KEY = "shipping-mark-state-v2";
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") return;
      Object.keys(saved).forEach((k) => setTweak(k, saved[k]));
    } catch (e) { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(t)); } catch (e) { /* quota */ }
  }, [t]);

  // ── Row helpers ────────────────────────────────────────────────────
  const setRow = (idx, next) => {
    const rows = (t.rows || []).slice();
    rows[idx] = next;
    setTweak("rows", rows);
  };
  const addRow = () => {
    // Refuse to add when the next row wouldn't fit. The button is
    // already disabled in the UI, but this guard catches keyboard /
    // programmatic invocations too.
    if (!canAddRow(t)) return;
    setTweak("rows", [...(t.rows || []), { label: "Label", value: "" }]);
  };
  const removeRow = (idx) => {
    if ((t.rows || []).length <= 1) return;
    setTweak("rows", t.rows.filter((_, i) => i !== idx));
  };

  // ── Logo upload ────────────────────────────────────────────────────
  const logoInputRef = useRef(null);
  const onPickLogo = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      setTweak("brandLogo", dataUrl);
      window.ACTIVITY && window.ACTIVITY.log("logo_uploaded", {
        size_kb: Math.round(dataUrl.length / 1024),
        type: file.type, name: file.name,
      });
    };
    reader.readAsDataURL(file);
  };

  // ── EAN-13 normalisation for export-time use ───────────────────────
  const normEan = window.BARCODE.normalizeEan13(t.ean13);
  const eanWidthMm = window.BARCODE.widthMm({ xDimMm: t.barcodeXDimMm });

  // ── CSV helpers ────────────────────────────────────────────────────
  // One row = one shipping mark. Columns:
  //   widthMm, heightMm, bleedMm, brandName, ean13, barcodeHeightMm, barcodeXDimMm,
  //   icon_<key> (1/0) for each ICON_ORDER key,
  //   row1_label, row1_value, …, rowN_label, rowN_value (up to 12 rows).
  const MAX_ROWS_CSV = 12;
  const stateToRow = (state) => {
    const out = {
      widthMm: state.widthMm,
      heightMm: state.heightMm,
      bleedMm: state.bleedMm,
      brandName: state.brandName || "",
      ean13: state.ean13 || "",
      barcodeHeightMm: state.barcodeHeightMm,
      barcodeXDimMm: state.barcodeXDimMm,
    };
    ICON_ORDER.forEach((k) => { out[`icon_${k}`] = (state.icons && state.icons[k]) ? "1" : "0"; });
    for (let i = 0; i < MAX_ROWS_CSV; i++) {
      const r = (state.rows || [])[i];
      out[`row${i + 1}_label`] = r ? r.label : "";
      out[`row${i + 1}_value`] = r ? r.value : "";
    }
    return out;
  };
  const rowToPartialState = (raw) => {
    const out = {};
    if (raw.widthMm) out.widthMm = parseFloat(raw.widthMm);
    if (raw.heightMm) out.heightMm = parseFloat(raw.heightMm);
    if (raw.bleedMm) out.bleedMm = parseFloat(raw.bleedMm);
    if (raw.brandName != null) out.brandName = raw.brandName;
    if (raw.ean13) out.ean13 = raw.ean13;
    if (raw.barcodeHeightMm) out.barcodeHeightMm = parseFloat(raw.barcodeHeightMm);
    if (raw.barcodeXDimMm) out.barcodeXDimMm = parseFloat(raw.barcodeXDimMm);
    const icons = {};
    let touchedIcons = false;
    ICON_ORDER.forEach((k) => {
      const v = raw[`icon_${k}`];
      if (v != null && v !== "") {
        touchedIcons = true;
        icons[k] = /^(1|true|yes)$/i.test(v);
      }
    });
    if (touchedIcons) out.icons = icons;
    const rows = [];
    for (let i = 0; i < MAX_ROWS_CSV; i++) {
      const lab = (raw[`row${i + 1}_label`] || "").trim();
      const val = (raw[`row${i + 1}_value`] || "").trim();
      if (lab || val) rows.push({ label: lab, value: val });
    }
    if (rows.length) out.rows = rows;
    return out;
  };
  const csvEscape = (v) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const stateToCsv = (state) => {
    const r = stateToRow(state);
    const headers = Object.keys(r);
    return headers.join(",") + "\n" + headers.map(h => csvEscape(r[h])).join(",");
  };
  const parseCsv = (text) => {
    const rows = [];
    let cur = "", row = [], inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else cur += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ",") { row.push(cur); cur = ""; }
        else if (ch === "\n" || ch === "\r") {
          if (ch === "\r" && text[i + 1] === "\n") i++;
          row.push(cur); rows.push(row); row = []; cur = "";
        } else cur += ch;
      }
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    if (!rows.length) return [];
    const headers = rows[0].map(h => h.trim());
    return rows.slice(1)
      .filter(r => r.some(c => (c || "").trim() !== ""))
      .map(r => {
        const o = {};
        headers.forEach((h, i) => { o[h] = (r[i] ?? "").trim(); });
        return o;
      });
  };

  const csvInputRef = useRef(null);
  const batchInputRef = useRef(null);

  const exportCsv = useCallback(() => {
    const csv = stateToCsv(t);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (t.brandName || "shipping-mark").replace(/[^a-z0-9 \-_]/gi, "").trim() + ".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    window.ACTIVITY && window.ACTIVITY.log("csv_exported", {
      brand: t.brandName || null,
    });
  }, [t]);

  const importCsv = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseCsv(String(reader.result || ""));
        if (!rows.length) { alert("CSV is empty."); return; }
        if (rows.length > 1) {
          alert(`This CSV has ${rows.length} entries. Use "Batch CSV → multi-page PDF" to generate one PDF per row, or this will only load the first.`);
        }
        const patch = rowToPartialState(rows[0]);
        Object.keys(patch).forEach(k => setTweak(k, patch[k]));
        window.ACTIVITY && window.ACTIVITY.log("csv_imported", { row_count: rows.length });
      } catch (e) { alert("Could not load CSV: " + e.message); }
    };
    reader.readAsText(file);
  }, [setTweak]);

  const resetState = useCallback(() => {
    if (!window.confirm("Reset all fields to the default shipping mark?")) return;
    Object.keys(DEFAULTS).forEach(k => setTweak(k, DEFAULTS[k]));
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }, [setTweak]);

  // ── PDF export pipeline ────────────────────────────────────────────
  // Lays out one page per shipping mark, sized exactly
  // (widthMm + 2·bleedMm) × (heightMm + 2·bleedMm). Brand logo is rasterised
  // (PNG → optional B&W threshold) and placed; everything else is drawn as
  // pure CMYK vector primitives. The barcode is drawn LAST as the topmost
  // element via `window.BARCODE.drawToPdf` so nothing can overlap its bars.
  const renderPageIntoPdf = useCallback(async (pdf, state) => {
    const W = state.widthMm, H = state.heightMm, B = state.bleedMm || 0;
    const trimX = B, trimY = B;

    // CMYK-pure black & helper setters (jsPDF expects 0–1).
    const setBlackFill   = () => pdf.setFillColor(0, 0, 0, 1);
    const setBlackText   = () => pdf.setTextColor(0, 0, 0, 1);
    const setBlackStroke = () => pdf.setDrawColor(0, 0, 0, 1);

    // ─── 1. Logo (top-left of trim area). ────────────────────────────
    const PAD_X = 5, PAD_Y = 4;
    const LOGO_MAX_W = 30, LOGO_MAX_H = 10;
    let logoBottomY = trimY + PAD_Y;
    let logoRightX = trimX + PAD_X;
    if (state.brandLogo) {
      try {
        const src = state.brandLogoBw ? await logoToBlackPng(state.brandLogo) : state.brandLogo;
        // Probe natural size to preserve aspect ratio.
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
        logoRightX = trimX + PAD_X + lw + 3;
      } catch (e) {
        console.warn("Logo embed failed:", e);
      }
    }

    // ─── 2. Brand name (right of logo, vertical-centred to its height). ───
    if (state.brandName) {
      setBlackText();
      pdf.setFont("Helvetica", "bold");
      const sizeMm = 4.2;
      pdf.setFontSize(sizeMm * 2.83465);
      const baseY = trimY + PAD_Y + sizeMm * 0.85;
      pdf.text(state.brandName, logoRightX, baseY);
    }
    const bodyTopY = Math.max(logoBottomY, trimY + PAD_Y + 5) + 2.5;

    // ─── 3. Reserve right-hand columns for icons + barcode. ──────────
    const eanW = window.BARCODE.widthMm({ xDimMm: state.barcodeXDimMm });
    const barcodeBlockW = eanW;
    const enabledIcons = [
      ...ICON_ORDER.filter(k => state.icons && state.icons[k]),
      ...(state.customIcons || []).filter(c => state.icons && state.icons[c.key]).map(c => c.key),
    ];
    const ICON_GAP = 2;
    // Pack icons using the same wrap rules as CSS — the icons block
    // max-width is dynamic (availableIconsRegionMm reserves space for
    // the text rows column) and is fed to packIcons here so the PDF
    // wrap point exactly mirrors the live preview.
    const iconsMaxW = availableIconsRegionMm(state).availW;
    const packed = packIcons(enabledIcons, state, ICON_GAP, iconsMaxW);
    const iconsBlockW = packed.totalW;

    const rightEdgeX = trimX + W - PAD_X;
    const barcodeX   = rightEdgeX - barcodeBlockW;
    const iconsRightX = barcodeX - 4;
    const iconsLeftX  = iconsRightX - iconsBlockW;

    // ─── 4. Text rows (left column). ─────────────────────────────────
    const rowsLeftX = trimX + PAD_X;
    const rowsRightLimit = iconsLeftX - 3;
    // Row text size — driven by state so the user's slider in
    // Advanced settings affects the PDF render the same way it
    // affects the preview (.sm-row { font-size: var(--row-text-size-mm) }).
    const rowSizeMm = state.rowTextSizeMm || 2.6;
    const rowGapMm = 0.8;
    const rowLineH = rowSizeMm * 1.25;

    setBlackText();
    pdf.setFontSize(rowSizeMm * 2.83465);
    let rowY = bodyTopY + rowSizeMm * 0.85;
    const rows = state.rows || [];
    // Compute max label width so values line up.
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

    // ─── 5. Handling icons — drawn via svg2pdf (the same library we
    //    use for the barcode) so SVG fills, strokes, and transforms
    //    all render correctly to PDF. Replaces the previous hand-rolled
    //    drawSvgToPdf walker which was emitting filled icons as hollow
    //    outlines because of an incomplete fill-mode pipeline. svg2pdf
    //    handles all of that via the BWIPP/jsPDF integration we
    //    already loaded for the barcode.
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
      // svg2pdf needs each <svg> to be self-contained — most of our
      // icons use `fill="currentColor"` which inherits from CSS, so we
      // clone each SVG and bake in the resolved black colour before
      // handing it to svg2pdf. Otherwise currentColor renders as
      // 'inherit' in PDF context, which becomes invisible.
      const placements = packed.placements;
      for (const { key, x, y, sz } of placements) {
        const src = svgByKey[key];
        if (!src) continue;
        const cloned = src.cloneNode(true);
        // Resolve currentColor → black on every fill / stroke attr.
        cloned.querySelectorAll("[fill]").forEach((el) => {
          const f = el.getAttribute("fill");
          if (f === "currentColor") el.setAttribute("fill", "#000");
        });
        cloned.querySelectorAll("[stroke]").forEach((el) => {
          const s = el.getAttribute("stroke");
          if (s === "currentColor") el.setAttribute("stroke", "#000");
        });
        // The cloned node must be in the DOM for svg2pdf to measure
        // it. Attach to a hidden off-screen container, render, detach.
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

    // ─── 6. Crop marks (corner ticks at the trim boundary, in the bleed). ──
    if (state.showCropMarks && B > 0) {
      setBlackStroke();
      pdf.setLineWidth(0.15);
      const tick = Math.min(3, B);
      const corners = [
        [trimX, trimY],
        [trimX + W, trimY],
        [trimX, trimY + H],
        [trimX + W, trimY + H],
      ];
      // Two segments per corner, just outside the trim into the bleed
      const draw = (x, y, dx, dy) => pdf.line(x, y, x + dx, y + dy);
      // top-left
      draw(trimX - tick, trimY, tick - 0.5, 0);
      draw(trimX, trimY - tick, 0, tick - 0.5);
      // top-right
      draw(trimX + W + 0.5, trimY, tick - 0.5, 0);
      draw(trimX + W, trimY - tick, 0, tick - 0.5);
      // bottom-left
      draw(trimX - tick, trimY + H, tick - 0.5, 0);
      draw(trimX, trimY + H + 0.5, 0, tick - 0.5);
      // bottom-right
      draw(trimX + W + 0.5, trimY + H, tick - 0.5, 0);
      draw(trimX + W, trimY + H + 0.5, 0, tick - 0.5);
      void corners;  // (kept for clarity if extending)
    }

    // ─── 7. Barcode — drawn LAST so nothing overlaps it. ─────────────
    // BARCODE.drawToPdf is now async (it delegates to svg2pdf.js, which
    // walks the SVG DOM and emits PDF vector ops via a Promise). Already
    // inside an async useCallback, so just await directly.
    const eanNorm = window.BARCODE.normalizeEan13(state.ean13);
    if (eanNorm.ok) {
      const barY = trimY + H - PAD_Y - state.barcodeHeightMm - 3.5;
      await window.BARCODE.drawToPdf(pdf, {
        digits: eanNorm.digits,
        x: barcodeX,
        y: barY,
        xDimMm: state.barcodeXDimMm,
        heightMm: state.barcodeHeightMm,
        includeText: true,
      });
    }
  }, []);

  // ── SVG transform helpers ────────────────────────────────────────
  // We thread a current transformation matrix (CTM) through the walker so
  // Inkscape-saved SVGs (e.g. the official ISO 7000 artwork on Wikimedia
  // Commons, which uses nested <g transform=…>) render correctly. CTM is a
  // 6-tuple [a, b, c, d, e, f] representing:
  //   [a c e]
  //   [b d f]   x' = a*x + c*y + e,  y' = b*x + d*y + f
  //   [0 0 1]
  const IDENTITY = [1, 0, 0, 1, 0, 0];
  const composeM = (A, B) => [
    A[0]*B[0] + A[2]*B[1],
    A[1]*B[0] + A[3]*B[1],
    A[0]*B[2] + A[2]*B[3],
    A[1]*B[2] + A[3]*B[3],
    A[0]*B[4] + A[2]*B[5] + A[4],
    A[1]*B[4] + A[3]*B[5] + A[5],
  ];
  const applyM = (M, x, y) => [ M[0]*x + M[2]*y + M[4], M[1]*x + M[3]*y + M[5] ];
  // Average X/Y scale factor — used to scale stroke widths through the CTM.
  const scaleM = (M) => Math.sqrt(Math.abs(M[0]*M[3] - M[1]*M[2]));
  // Parse an SVG `transform=` attribute string (supports translate, scale,
  // matrix, rotate — covers everything in the ISO 7000 source SVGs).
  const parseTransform = (str) => {
    if (!str) return IDENTITY;
    let m = IDENTITY;
    const re = /(translate|scale|matrix|rotate)\s*\(([-\d.,\s]+)\)/g;
    let match;
    while ((match = re.exec(str))) {
      const op = match[1];
      const args = match[2].split(/[\s,]+/).map(Number).filter(n => !Number.isNaN(n));
      let t = IDENTITY;
      if (op === "translate") {
        t = [1, 0, 0, 1, args[0] || 0, args[1] || 0];
      } else if (op === "scale") {
        const sx = args[0] ?? 1, sy = args[1] ?? sx;
        t = [sx, 0, 0, sy, 0, 0];
      } else if (op === "matrix" && args.length >= 6) {
        t = args.slice(0, 6);
      } else if (op === "rotate") {
        const rad = (args[0] || 0) * Math.PI / 180;
        const c = Math.cos(rad), s = Math.sin(rad);
        if (args.length >= 3) {
          // rotate(angle, cx, cy): translate(cx,cy) · rotate · translate(-cx,-cy)
          const cx = args[1], cy = args[2];
          t = composeM([1,0,0,1,cx,cy], composeM([c,s,-s,c,0,0], [1,0,0,1,-cx,-cy]));
        } else {
          t = [c, s, -s, c, 0, 0];
        }
      }
      m = composeM(m, t);
    }
    return m;
  };

  // SVG → jsPDF vector walker (covers all shapes we ship, including the
  // official ISO 7000 SVGs with their nested transforms).
  const drawSvgToPdf = useCallback((pdf, svg, x, y, w, h) => {
    const vb = (svg.getAttribute("viewBox") || "0 0 32 32").trim().split(/\s+/).map(Number);
    const [vbX, vbY, vbW, vbH] = vb.length === 4 ? vb : [0, 0, 32, 32];
    const sx = w / vbW, sy = h / vbH;
    // T() converts from CTM-resolved viewBox coordinates to PDF mm.
    const T = (px, py) => [x + (px - vbX) * sx, y + (py - vbY) * sy];
    const swPx = parseFloat(svg.getAttribute("stroke-width") || "2");
    const sw = swPx * sx;
    pdf.setDrawColor(0, 0, 0, 1);
    pdf.setFillColor(0, 0, 0, 1);
    pdf.setLineWidth(sw);
    pdf.setLineCap("round");
    pdf.setLineJoin("round");

    // SVG fill/stroke inherit down the tree. We thread the resolved fill
    // and stroke through the recursion so both idioms work:
    //  - the built-in stroke-only icons (svg root: fill="none" stroke="…")
    //  - the official ISO 7000 SVGs (paths with explicit fill="#000" or
    //    relying on SVG's default fill=black, stroke=none)
    const rootFill = svg.getAttribute("fill");
    const rootStroke = svg.getAttribute("stroke");

    const drawChildren = (parent, ctm, parentFill, parentStroke) => {
      for (const child of parent.children) {
        const tag = child.tagName.toLowerCase();
        const localT = parseTransform(child.getAttribute("transform") || "");
        const childCTM = composeM(ctm, localT);
        const childFill = child.getAttribute("fill") ?? parentFill;
        const childStroke = child.getAttribute("stroke") ?? parentStroke;
        if (tag === "g") {
          drawChildren(child, childCTM, childFill, childStroke);
          continue;
        }
        // CT() = compose CTM + viewBox→PDF, in one call site for primitives.
        const CT = (px, py) => {
          const [tx, ty] = applyM(childCTM, px, py);
          return T(tx, ty);
        };
        // SVG default: fill = black, stroke = none. (So a path with no
        // attributes and no inherited fill/stroke is a solid black shape.)
        const isFilled = childFill == null
          ? true
          : childFill !== "none" && !/url\(/.test(childFill);
        const isStroked = childStroke != null && childStroke !== "none";
        const style = isFilled && isStroked ? "FD" : isFilled ? "F" : "S";
        // Honour per-element stroke-width through the CTM.
        const localSw = parseFloat(child.getAttribute("stroke-width") || swPx);
        if (Number.isFinite(localSw)) pdf.setLineWidth(localSw * sx * scaleM(childCTM));

        if (tag === "line") {
          const [x1, y1] = CT(+child.getAttribute("x1"), +child.getAttribute("y1"));
          const [x2, y2] = CT(+child.getAttribute("x2"), +child.getAttribute("y2"));
          pdf.line(x1, y1, x2, y2);
        } else if (tag === "rect") {
          // Rects under a non-uniform CTM are rare in our icons — emit as
          // a 4-point polygon to stay correct under translation/scaling/rotation.
          const rx0 = +(child.getAttribute("x") || 0), ry0 = +(child.getAttribute("y") || 0);
          const rw = +child.getAttribute("width"), rh = +child.getAttribute("height");
          const p1 = CT(rx0, ry0), p2 = CT(rx0 + rw, ry0);
          const p3 = CT(rx0 + rw, ry0 + rh), p4 = CT(rx0, ry0 + rh);
          if (isFilled) {
            pdf.triangle(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1], "F");
            pdf.triangle(p1[0], p1[1], p3[0], p3[1], p4[0], p4[1], "F");
          }
          if (isStroked || !isFilled) {
            pdf.line(p1[0], p1[1], p2[0], p2[1]);
            pdf.line(p2[0], p2[1], p3[0], p3[1]);
            pdf.line(p3[0], p3[1], p4[0], p4[1]);
            pdf.line(p4[0], p4[1], p1[0], p1[1]);
          }
        } else if (tag === "circle") {
          // Under a uniform-scale CTM, a circle stays a circle (with scaled radius).
          const [cx, cy] = CT(+child.getAttribute("cx"), +child.getAttribute("cy"));
          const r = +child.getAttribute("r") * sx * scaleM(childCTM);
          pdf.circle(cx, cy, r, style);
        } else if (tag === "ellipse") {
          const [cx, cy] = CT(+child.getAttribute("cx"), +child.getAttribute("cy"));
          pdf.ellipse(cx, cy,
            +child.getAttribute("rx") * sx * scaleM(childCTM),
            +child.getAttribute("ry") * sy * scaleM(childCTM),
            style);
        } else if (tag === "polygon" || tag === "polyline") {
          const nums = (child.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number);
          const pts = [];
          for (let i = 0; i < nums.length; i += 2) pts.push(CT(nums[i], nums[i + 1]));
          for (let i = 0; i < pts.length - 1; i++) pdf.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
          if (tag === "polygon" && pts.length > 2) {
            pdf.line(pts.at(-1)[0], pts.at(-1)[1], pts[0][0], pts[0][1]);
            if (isFilled) {
              for (let i = 1; i < pts.length - 1; i++) {
                pdf.triangle(pts[0][0], pts[0][1], pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], "F");
              }
            }
          }
        } else if (tag === "path") {
          drawPath(pdf, child.getAttribute("d") || "", CT, sx, sy, isFilled);
        }
      }
    };
    drawChildren(svg, IDENTITY, rootFill, rootStroke);
  }, []);

  // SVG arc → cubic Bézier conversion (W3C SVG 1.1 implementation notes,
  // appendix B.2.4 "Conversion from endpoint to center parameterization").
  // Returns an array of [c1x, c1y, c2x, c2y, x, y] cubic segments. We need
  // this because the official ISO 7000-0626 (Keep Dry, umbrella canopy) and
  // ISO 7000-0632 (Temperature Limit, thermometer bulb) use SVG `A` arcs;
  // without conversion they'd be silently dropped from the PDF export.
  const arcToCubics = (x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2) => {
    if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [];
    const phi = phiDeg * Math.PI / 180;
    const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
    // 1. Compute (x1', y1') — endpoint shifted to midpoint and rotated
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const x1p =  cosPhi * dx + sinPhi * dy;
    const y1p = -sinPhi * dx + cosPhi * dy;
    rx = Math.abs(rx); ry = Math.abs(ry);
    let rxSq = rx * rx, rySq = ry * ry;
    const x1pSq = x1p * x1p, y1pSq = y1p * y1p;
    // Ensure radii are large enough (SVG spec correction)
    const lam = x1pSq / rxSq + y1pSq / rySq;
    if (lam > 1) {
      const k = Math.sqrt(lam);
      rx *= k; ry *= k;
      rxSq = rx * rx; rySq = ry * ry;
    }
    // 2. Compute (cx', cy')
    const sign = (largeArc === sweep) ? -1 : 1;
    const sq = Math.max(0,
      ((rxSq * rySq) - (rxSq * y1pSq) - (rySq * x1pSq)) /
      ((rxSq * y1pSq) + (rySq * x1pSq))
    );
    const coef = sign * Math.sqrt(sq);
    const cxp = coef * (rx * y1p) / ry;
    const cyp = coef * -(ry * x1p) / rx;
    // 3. Compute (cx, cy)
    const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
    const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;
    // 4. Compute theta1 and deltaTheta
    const angle = (ux, uy, vx, vy) => {
      const dot = ux * vx + uy * vy;
      const len = Math.sqrt((ux*ux + uy*uy) * (vx*vx + vy*vy));
      let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
      if (ux * vy - uy * vx < 0) a = -a;
      return a;
    };
    const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dtheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
    if ( sweep && dtheta < 0) dtheta += 2 * Math.PI;
    // 5. Split into ≤90° segments and emit cubic Béziers per segment.
    const segs = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2)));
    const segDt = dtheta / segs;
    const tFactor = (4 / 3) * Math.tan(segDt / 4);
    const out = [];
    let th = theta1, px = x1, py = y1;
    for (let i = 0; i < segs; i++) {
      const th2 = th + segDt;
      const cT = Math.cos(th), sT = Math.sin(th);
      const cT2 = Math.cos(th2), sT2 = Math.sin(th2);
      const ex = cosPhi * rx * cT2 - sinPhi * ry * sT2 + cx;
      const ey = sinPhi * rx * cT2 + cosPhi * ry * sT2 + cy;
      const c1x = px + tFactor * (-cosPhi * rx * sT - sinPhi * ry * cT);
      const c1y = py + tFactor * (-sinPhi * rx * sT + cosPhi * ry * cT);
      const c2x = ex + tFactor * ( cosPhi * rx * sT2 + sinPhi * ry * cT2);
      const c2y = ey + tFactor * ( sinPhi * rx * sT2 - cosPhi * ry * cT2);
      out.push([c1x, c1y, c2x, c2y, ex, ey]);
      th = th2; px = ex; py = ey;
    }
    return out;
  };

  // SVG path emitter — supports M/L/H/V/Q/T/C/S/A/Z. Tokeniser is
  // length-aware so consecutive command-pairs (e.g. "M…L…L…" implicit
  // continuation) work without re-stating the letter.
  //
  // Sub-path flushing:
  //   - Stroked paths (fill=false): emit each segment as a separate
  //     pdf.lines call so individual line/curve segments stroke cleanly.
  //   - Filled paths (fill=true): accumulate every segment into ONE
  //     pdf.lines call with style="F" and closed=true. This is what
  //     icons need — without it, every filled path silhouette renders
  //     as a hollow outline (the bug the user saw in the PDF export).
  const drawPath = useCallback((pdf, d, T, sx, sy, fill) => {
    if (!d) return;
    const cmds = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[+-]?\d+)?/g) || [];
    let cx = 0, cy = 0, startX = 0, startY = 0;
    let i = 0;
    const num = () => parseFloat(cmds[i++]);
    let cmd = "";
    let currentPath = [];
    const flushSubpath = () => {
      if (currentPath.length < 2) return;
      if (fill) {
        // Build one big segments list relative to the previous point.
        // pdf.lines moves a virtual cursor: each segment is relative to
        // where the last one ended, so we use prev → current deltas.
        const start = currentPath[0];
        const segments = [];
        for (let k = 1; k < currentPath.length; k++) {
          const prev = currentPath[k - 1];
          const b = currentPath[k];
          if (b.curve) {
            segments.push([
              b.c1x - prev.tx, b.c1y - prev.ty,
              b.c2x - prev.tx, b.c2y - prev.ty,
              b.tx  - prev.tx, b.ty  - prev.ty,
            ]);
          } else {
            segments.push([b.tx - prev.tx, b.ty - prev.ty]);
          }
        }
        // style "F" = fill; closed=true closes the subpath back to start.
        pdf.lines(segments, start.tx, start.ty, [1, 1], "F", true);
      } else {
        for (let k = 0; k < currentPath.length - 1; k++) {
          const a = currentPath[k], b = currentPath[k + 1];
          if (b.curve) {
            pdf.lines([[
              b.c1x - a.tx, b.c1y - a.ty,
              b.c2x - a.tx, b.c2y - a.ty,
              b.tx - a.tx,  b.ty - a.ty,
            ]], a.tx, a.ty, [1, 1], "S", false);
          } else {
            pdf.line(a.tx, a.ty, b.tx, b.ty);
          }
        }
      }
    };
    while (i < cmds.length) {
      const tok = cmds[i];
      if (/^[a-zA-Z]$/.test(tok)) { cmd = tok; i++; }
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      if (C === "M") {
        const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
        if (currentPath.length) flushSubpath();
        const [tx, ty] = T(x, y);
        currentPath = [{ x, y, tx, ty }];
        cx = x; cy = y; startX = x; startY = y;
        cmd = rel ? "l" : "L";
      } else if (C === "L") {
        const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
        const [tx, ty] = T(x, y);
        currentPath.push({ x, y, tx, ty });
        cx = x; cy = y;
      } else if (C === "H") {
        const x = num() + (rel ? cx : 0);
        const [tx, ty] = T(x, cy);
        currentPath.push({ x, y: cy, tx, ty });
        cx = x;
      } else if (C === "V") {
        const y = num() + (rel ? cy : 0);
        const [tx, ty] = T(cx, y);
        currentPath.push({ x: cx, y, tx, ty });
        cy = y;
      } else if (C === "Q") {
        const qx = num() + (rel ? cx : 0), qy = num() + (rel ? cy : 0);
        const ex = num() + (rel ? cx : 0), ey = num() + (rel ? cy : 0);
        const c1x = cx + (2/3) * (qx - cx), c1y = cy + (2/3) * (qy - cy);
        const c2x = ex + (2/3) * (qx - ex), c2y = ey + (2/3) * (qy - ey);
        const [tx, ty]   = T(ex, ey);
        const [tc1x, tc1y] = T(c1x, c1y);
        const [tc2x, tc2y] = T(c2x, c2y);
        currentPath.push({ x: ex, y: ey, tx, ty, curve: true, c1x: tc1x, c1y: tc1y, c2x: tc2x, c2y: tc2y });
        cx = ex; cy = ey;
      } else if (C === "C") {
        const c1xv = num() + (rel ? cx : 0), c1yv = num() + (rel ? cy : 0);
        const c2xv = num() + (rel ? cx : 0), c2yv = num() + (rel ? cy : 0);
        const ex = num() + (rel ? cx : 0), ey = num() + (rel ? cy : 0);
        const [tx, ty]   = T(ex, ey);
        const [tc1x, tc1y] = T(c1xv, c1yv);
        const [tc2x, tc2y] = T(c2xv, c2yv);
        currentPath.push({ x: ex, y: ey, tx, ty, curve: true, c1x: tc1x, c1y: tc1y, c2x: tc2x, c2y: tc2y });
        cx = ex; cy = ey;
      } else if (C === "S") {
        // Smooth cubic: c1 is the reflection of the previous segment's c2.
        const c2xv = num() + (rel ? cx : 0), c2yv = num() + (rel ? cy : 0);
        const ex = num() + (rel ? cx : 0), ey = num() + (rel ? cy : 0);
        const prev = currentPath.at(-1);
        let c1xv, c1yv;
        if (prev && prev.curve && prev.c2x_orig !== undefined) {
          c1xv = 2 * cx - prev.c2x_orig;
          c1yv = 2 * cy - prev.c2y_orig;
        } else {
          c1xv = cx; c1yv = cy;
        }
        const [tx, ty]   = T(ex, ey);
        const [tc1x, tc1y] = T(c1xv, c1yv);
        const [tc2x, tc2y] = T(c2xv, c2yv);
        currentPath.push({
          x: ex, y: ey, tx, ty, curve: true,
          c1x: tc1x, c1y: tc1y, c2x: tc2x, c2y: tc2y,
          c2x_orig: c2xv, c2y_orig: c2yv,
        });
        cx = ex; cy = ey;
      } else if (C === "A") {
        // SVG arc: 7 args (rx ry x-axis-rotation large-arc-flag sweep-flag x y).
        // Convert to one or more cubic Béziers (the math lives in arcToCubics
        // above). Each cubic segment becomes its own currentPath entry.
        const rx = num(), ry = num(), phi = num();
        const largeArc = num() !== 0, sweep = num() !== 0;
        const ex = num() + (rel ? cx : 0), ey = num() + (rel ? cy : 0);
        const segs = arcToCubics(cx, cy, rx, ry, phi, largeArc, sweep, ex, ey);
        for (const [c1xv, c1yv, c2xv, c2yv, sx2, sy2] of segs) {
          const [tx, ty]   = T(sx2, sy2);
          const [tc1x, tc1y] = T(c1xv, c1yv);
          const [tc2x, tc2y] = T(c2xv, c2yv);
          currentPath.push({
            x: sx2, y: sy2, tx, ty, curve: true,
            c1x: tc1x, c1y: tc1y, c2x: tc2x, c2y: tc2y,
          });
          cx = sx2; cy = sy2;
        }
      } else if (C === "Z") {
        if (currentPath.length) {
          const [tx, ty] = T(startX, startY);
          currentPath.push({ x: startX, y: startY, tx, ty });
          cx = startX; cy = startY;
        }
      } else { i++; }
    }
    if (currentPath.length) flushSubpath();
  }, []);

  // Snapshot for batch mode + render-await helpers (mirrors DS).
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);
  const waitForRender = (extraMs = 200) =>
    new Promise(r => requestAnimationFrame(() =>
      requestAnimationFrame(() => setTimeout(r, extraMs))));
  const withStageNeutral = async (fn) => {
    const stage = document.querySelector(".stage");
    const card = document.querySelector(".shipping-mark");
    const prev = {
      stT: stage ? stage.style.transform : "", stW: stage ? stage.style.width : "", stH: stage ? stage.style.height : "",
      cT: card ? card.style.transform : "", cO: card ? card.style.transformOrigin : "",
    };
    if (stage) { stage.style.transform = "none"; stage.style.width = "auto"; stage.style.height = "auto"; }
    if (card)  { card.style.transform = "none"; card.style.transformOrigin = ""; }
    try { return await fn(); }
    finally {
      if (stage) { stage.style.transform = prev.stT; stage.style.width = prev.stW; stage.style.height = prev.stH; }
      if (card)  { card.style.transform = prev.cT; card.style.transformOrigin = prev.cO; }
    }
  };

  // ── Download CURRENT state as a single-page PDF ────────────────────
  const downloadPdf = useCallback(async () => {
    if (!window.jspdf) {
      alert("PDF library is still loading—please try again in a moment.");
      return;
    }
    const norm = window.BARCODE.normalizeEan13(t.ean13);
    if (!norm.ok) {
      alert("Cannot export: " + norm.error);
      return;
    }
    await withStageNeutral(async () => {
      try {
        const pageW = t.widthMm + 2 * (t.bleedMm || 0);
        const pageH = t.heightMm + 2 * (t.bleedMm || 0);
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
          orientation: pageW >= pageH ? "landscape" : "portrait",
          unit: "mm", format: [pageW, pageH], compress: true,
        });
        await renderPageIntoPdf(pdf, t);
        const safe = (t.brandName || "shipping-mark").replace(/[^a-z0-9 \-_]/gi, "").trim() || "shipping-mark";
        pdf.save(`${safe} (${t.widthMm}x${t.heightMm}mm).pdf`);
        const enabledNow = ICON_ORDER.filter(k => t.icons && t.icons[k]).length
          + (t.customIcons || []).filter(c => t.icons && t.icons[c.key]).length;
        window.ACTIVITY && window.ACTIVITY.log("pdf_exported", {
          width_mm: t.widthMm, height_mm: t.heightMm, bleed_mm: t.bleedMm || 0,
          ean13: norm.digits, icon_count: enabledNow, brand: t.brandName || null,
        });
      } catch (e) {
        console.error("PDF export failed:", e);
        alert("PDF export failed: " + (e?.message || e));
      }
    });
  }, [t, renderPageIntoPdf]);

  // ── Batch: CSV with N rows → N-page PDF ────────────────────────────
  const [batchProgress, setBatchProgress] = useState(null);
  const batchPdf = useCallback(async (file) => {
    if (!window.jspdf) {
      alert("PDF library is still loading—please try again in a moment.");
      return;
    }
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) { alert("CSV is empty."); return; }

    const snapshot = JSON.parse(JSON.stringify(tRef.current));
    await withStageNeutral(async () => {
      try {
        const { jsPDF } = window.jspdf;
        let pdf = null;
        for (let i = 0; i < rows.length; i++) {
          setBatchProgress({ i: i + 1, n: rows.length });
          const patch = rowToPartialState(rows[i]);
          const merged = { ...snapshot, ...patch };
          // Apply patch so the live preview & DOM (icons) update.
          Object.keys(patch).forEach(k => setTweak(k, patch[k]));
          await waitForRender(280);
          const pageW = merged.widthMm + 2 * (merged.bleedMm || 0);
          const pageH = merged.heightMm + 2 * (merged.bleedMm || 0);
          if (!pdf) {
            pdf = new jsPDF({
              orientation: pageW >= pageH ? "landscape" : "portrait",
              unit: "mm", format: [pageW, pageH], compress: true,
            });
          } else {
            pdf.addPage([pageW, pageH], pageW >= pageH ? "landscape" : "portrait");
          }
          await renderPageIntoPdf(pdf, merged);
        }
        pdf.save(`shipping-marks-batch-${rows.length}p.pdf`);
        window.ACTIVITY && window.ACTIVITY.log("batch_exported", { row_count: rows.length });
      } catch (e) {
        console.error("Batch PDF failed:", e);
        alert("Batch PDF failed: " + (e?.message || e));
      } finally {
        Object.keys(snapshot).forEach(k => setTweak(k, snapshot[k]));
        setBatchProgress(null);
      }
    });
  }, [renderPageIntoPdf, setTweak]);

  // ── Canvas navigation (Illustrator-style: pan + zoom via transform) ──
  // The card is rendered at its real mm dimensions and visually
  // positioned with ONE combined CSS transform:
  //   translate(panX, panY) scale(fitScale × userZoom)
  // No native scroll — we keep `.stage { overflow: hidden }` and let
  // pan offsets move the card anywhere in viewport space, exactly
  // like a design tool's infinite workspace.
  //
  // userZoom range is wide (0.1 – 6) so the user can shrink the card
  // below fit OR zoom right in. Drag-pan works at every zoom level
  // (no "only when zoomed in" gating). Wheel zoom is cursor-relative.
  const stageRef = useRef(null);
  const cardRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const fitScaleRef = useRef(1);
  // Spacebar-held flag — when true, drag-pan works from anywhere on
  // the canvas (incl. over editable elements). Like Illustrator's
  // hand-tool toggle.
  const spaceHeldRef = useRef(false);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);

  useEffect(() => {
    const stage = stageRef.current;
    const card = cardRef.current;
    if (!stage || !card) return;

    const apply = () => {
      const isMobile = window.matchMedia("(max-width: 768px)").matches;
      const avW = stage.clientWidth;
      const avH = stage.clientHeight;
      const cw = card.offsetWidth;
      const ch = card.offsetHeight;
      if (cw === 0 || ch === 0 || avW === 0 || avH === 0) return;
      const maxFit = isMobile ? 1.0 : 1.45;
      const fitScale = Math.min(avW / cw, avH / ch, maxFit);
      fitScaleRef.current = fitScale;
      const totalScale = fitScale * zoomRef.current;
      const { x: px, y: py } = panRef.current;
      // Single combined transform on the card. transform-origin: center
      // means scale and translate are relative to the card's own
      // centre, which (because the parent .stage is flex-centred) is
      // also the centre of the viewport at pan=0.
      card.style.transform = `translate(${px}px, ${py}px) scale(${totalScale})`;
      card.style.transformOrigin = "center";
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(stage);
    ro.observe(card);
    window.addEventListener("resize", apply);
    return () => { window.removeEventListener("resize", apply); ro.disconnect(); };
  }, [zoom, pan.x, pan.y, t.widthMm, t.heightMm, t.bleedMm]);

  // ── Wheel zoom (cursor-relative) ──────────────────────────────────
  // Scroll / pinch zooms keeping the point under the cursor anchored.
  // Math: cursor at viewport-pixel (cx, cy) relative to stage centre.
  // The card-space point under cursor is (cx − panX) / totalScale.
  // Solve for newPan so the same point stays under the cursor at the
  // new scale: newPan = cx − (cx − oldPan) × (newScale / oldScale).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e) => {
      e.preventDefault();
      const oldZoom = zoomRef.current;
      const delta = -e.deltaY / 1000;
      const next = Math.max(0.1, Math.min(6, oldZoom * Math.exp(delta)));
      if (next === oldZoom) return;
      const rect = stage.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const ratio = next / oldZoom;
      const oldPan = panRef.current;
      setPan({
        x: cx - (cx - oldPan.x) * ratio,
        y: cy - (cy - oldPan.y) * ratio,
      });
      setZoom(next);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  // ── Drag-pan (Illustrator hand-tool semantics) ────────────────────
  // Three ways to pan, all updating the same pan state:
  //   1. Click-and-drag on EMPTY canvas area (around the card, on the
  //      bleed margin, etc.) — works because the target isn't an
  //      editable element.
  //   2. Spacebar + drag anywhere (incl. over editable text). The
  //      cursor switches to "grab" the moment space is held so the
  //      affordance is obvious. This is the Illustrator standard.
  //   3. Middle-mouse-button drag anywhere. Same as spacebar+drag for
  //      users with a 3-button mouse.
  // Editable-content clicks still go through to the underlying field
  // when none of the above modifiers are active.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    // Spacebar tracking → also flip the cursor class so the affordance
    // is visible the instant the user holds space.
    const onKeyDown = (e) => {
      if (e.code !== "Space") return;
      // Ignore when typing inside an editable / input field.
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" ||
                     active.tagName === "TEXTAREA" ||
                     active.isContentEditable)) return;
      e.preventDefault();
      if (spaceHeldRef.current) return;
      spaceHeldRef.current = true;
      stage.classList.add("is-space-held");
    };
    const onKeyUp = (e) => {
      if (e.code !== "Space") return;
      spaceHeldRef.current = false;
      stage.classList.remove("is-space-held");
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    let drag = null;
    const onDown = (e) => {
      // Floating UI takes precedence — never pan from clicks on banner
      // / warning / zoom-controls.
      if (e.target.closest(".canvas-nav, .vyke-dev-banner, .vyke-canvas-warning")) return;
      const isMiddle = e.button === 1;
      const isSpace  = spaceHeldRef.current;
      const isOnEditable = !!e.target.closest(".editable, button, input, [contenteditable]");
      // Default-button click over editable → let the click through.
      // Anything else (middle-click, space-held, or click on empty
      // canvas) starts a pan.
      if (!isMiddle && !isSpace && isOnEditable) return;
      e.preventDefault();
      drag = {
        startX: e.clientX, startY: e.clientY,
        panX0: panRef.current.x, panY0: panRef.current.y,
      };
      stage.classList.add("is-panning");
      try { e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId); } catch {}
    };
    const onMove = (e) => {
      if (!drag) return;
      setPan({
        x: drag.panX0 + (e.clientX - drag.startX),
        y: drag.panY0 + (e.clientY - drag.startY),
      });
    };
    const onUp = () => {
      if (!drag) return;
      drag = null;
      stage.classList.remove("is-panning");
    };
    stage.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      stage.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  // Reset to default centred fit-to-view: zoom 100 %, pan 0,0.
  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);
  // Programmatic zoom (used by +/- buttons). Zooms around the
  // viewport centre — keeps the centred content in place.
  const zoomBy = useCallback((factor) => {
    setZoom((z) => Math.max(0.1, Math.min(6, z * factor)));
  }, []);

  // Enabled icons = built-ins (in canonical ICON_ORDER) + any custom uploads
  // currently toggled on. Custom keys are stored in t.icons just like built-ins.
  const enabledIcons = [
    ...ICON_ORDER.filter(k => t.icons && t.icons[k]),
    ...(t.customIcons || []).filter(c => t.icons && t.icons[c.key]).map(c => c.key),
  ];

  // Icon sizing reads directly from the user's slider value (t.iconSizeMm)
  // and any per-icon overrides in t.iconSizesMm. `.sm-trim` has
  // `overflow: hidden` so anything that doesn't fit gets cleanly clipped
  // — better UX than silently overriding the slider. We surface a red
  // warning in the Tweaks panel when the user's chosen size overflows
  // the available region so they know to dial it down.
  const iconsRegion = availableIconsRegionMm(t);
  const iconsDontFit = iconsOverflow(enabledIcons, t);
  // Suggested size = the largest that would actually fit all enabled icons.
  // Rounded down to 0.5 mm steps to match the slider.
  const suggestedIconMm = iconsDontFit
    ? Math.max(3, Math.floor(iconFitMaxMm(enabledIcons.length, iconsRegion) * 2) / 2)
    : null;

  // Row-fit flags: do current rows still fit? Can we add one more?
  // Drives the disabled state of both "+ Add row" buttons and the
  // canvas-level overflow warning.
  const rowCount = (t.rows || []).length;
  const rowsDontFit = rowsOverflow(rowCount, t);
  const rowAddBlocked = !canAddRow(t);

  // ── Icon upload (custom SVG → adds to library + auto-enables) ─────
  const iconInputRef = useRef(null);
  const onPickIcon = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/svg/i.test(file.type) && !/\.svg$/i.test(file.name)) {
      alert("Please upload an SVG file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      // Strip XML declaration/DOCTYPE and recolour fill/stroke to currentColor so
      // the icon adopts the CSS color (and the B&W filter works) — same as the
      // Data Sheet creator's IconPicker logic.
      let svg = String(reader.result || "").trim();
      svg = svg.replace(/<\?xml[^>]*\?>/g, "").replace(/<!DOCTYPE[^>]*>/g, "").trim();
      svg = svg
        .replace(/\bfill="(?!none\b)[^"]*"/gi, 'fill="currentColor"')
        .replace(/\bstroke="(?!none\b)[^"]*"/gi, 'stroke="currentColor"');
      const key = "custom_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const label = file.name.replace(/\.svg$/i, "").slice(0, 24) || "Custom";
      // Custom icons inherit ISO 780's "normal" 100mm as a reference; default
      // small (14mm) to fit typical labels.
      const entry = { key, label, svgString: svg, isoNormalMm: 100, safeMinMm: 19, defaultMm: 14 };
      setTweak("customIcons", [...(t.customIcons || []), entry]);
      setTweak("icons", { ...(t.icons || {}), [key]: true });
    };
    reader.readAsText(file);
  };
  const removeCustomIcon = (key) => {
    setTweak("customIcons", (t.customIcons || []).filter(c => c.key !== key));
    const nextIcons = { ...(t.icons || {}) };
    delete nextIcons[key];
    setTweak("icons", nextIcons);
    const nextSizes = { ...(t.iconSizesMm || {}) };
    delete nextSizes[key];
    setTweak("iconSizesMm", nextSizes);
  };

  return (
    <>
      {/* In-development banner — pinned to the top of the viewport so
          users are always aware we're actively iterating on the tool
          while they're using it. Matches the yellow notice inside the
          welcome card so the message is consistent across surfaces.
          Sits OUTSIDE .stage because .stage gets a transform: scale()
          for fit-to-frame rendering — putting the banner inside would
          shrink it along with the card. Hidden by body.vyke-locked
          while the welcome modal is up (it already shows the message). */}
      <div className="vyke-dev-banner" role="status" aria-live="polite">
        🚧 <b>In development</b> — we're shipping changes while you use the tool. Some features may behave oddly.
      </div>

      {/* Canvas-level icon overflow warning — shows when the user's
          chosen icon size won't fit the current card. Lives next to
          the canvas (not in the Tweaks panel) so the feedback is
          adjacent to the actual problem. Includes a one-click "Fit"
          button that snaps the slider to the largest size that fits. */}
      {(iconsDontFit || rowsDontFit) && (
        <div className="vyke-canvas-warnings">
          {rowsDontFit && (
            <div className="vyke-canvas-warning" role="alert" aria-live="polite">
              <span>
                <b>{rowCount} rows don't fit.</b>
                {" "}Make the card taller, or remove a row.
              </span>
              <button
                type="button"
                onClick={() => removeRow(rowCount - 1)}
                disabled={rowCount <= 1}
                title={rowCount <= 1 ? "Can't remove the last row" : ""}
              >
                Remove last row
              </button>
            </div>
          )}
          {iconsDontFit && (
            <div className="vyke-canvas-warning" role="alert" aria-live="polite">
              <span>
                <b>Icons don't fit at {t.iconSizeMm || 14}&nbsp;mm.</b>
                {" "}They'll be clipped in the preview and PDF.
              </span>
              {suggestedIconMm > 0 && (
                <button
                  type="button"
                  onClick={() => setTweak("iconSizeMm", suggestedIconMm)}
                >
                  Fit to {suggestedIconMm}&nbsp;mm
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Canvas navigation: zoom out / current zoom (click to reset) /
          zoom in. Pinned to the bottom-left of the viewport so it
          doesn't compete with the dev banner top-centre or the
          overflow warning bottom-centre. Wheel-zoom + drag-pan still
          work on the canvas itself; these buttons are the discoverable
          fallback. */}
      <div className="canvas-nav" role="toolbar" aria-label="Canvas navigation">
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.25)}
          disabled={zoom <= 0.11}
          title={zoom <= 0.11 ? "Already at minimum zoom" : "Zoom out (or scroll down on the canvas)"}
          aria-label="Zoom out"
        >−</button>
        <button
          type="button"
          className="canvas-nav-pct"
          onClick={resetView}
          title="Reset to fit-to-screen"
        >{Math.round(zoom * 100)}%</button>
        <button
          type="button"
          onClick={() => zoomBy(1.25)}
          title="Zoom in (or scroll up on the canvas)"
          aria-label="Zoom in"
        >+</button>
      </div>

      <div className="stage" ref={stageRef}>
        <div
          className="shipping-mark"
          style={{
            "--w-mm": t.widthMm,
            "--h-mm": t.heightMm,
            "--bleed-mm": t.bleedMm || 0,
            // Reserve horizontal + vertical room in the body grid for the
            // absolutely-positioned barcode at bottom-right. Kept in sync
            // with the PDF render's PAD_X/PAD_Y constants (5mm/4mm) and the
            // barcode height + human-readable digits (≈ +3.5mm).
            "--barcode-w-mm": window.BARCODE.widthMm({ xDimMm: t.barcodeXDimMm }) + 4,
            "--barcode-block-h-mm": (t.barcodeHeightMm || 20) + 6,
            // Dynamic max-width for the icons block: enough room for them
            // to spread horizontally on wide cards, but reserves at least
            // ~40 mm for the text rows column. Source-of-truth for the
            // same value the PDF packer uses, so wrap is identical.
            "--icons-max-w-mm": availableIconsRegionMm(t).availW,
            // Row text size in mm — drives both `.sm-row { font-size }`
            // for the preview and rowLineHeightMm for overflow math.
            "--row-text-size-mm": t.rowTextSizeMm || 2.6,
          }}
          ref={cardRef}
        >
          <div className="sm-trim">
            <div className="sm-header">
              <BrandLogo src={t.brandLogo} bw={t.brandLogoBw} />
              <Editable
                className="sm-brand"
                value={t.brandName}
                onChange={(v) => setTweak("brandName", v)}
                placeholder="BRAND"
              />
            </div>

            <div className="sm-body">
              <div className="sm-rows">
                {(t.rows || []).map((r, i) => (
                  <div key={i} className="sm-row">
                    <Editable
                      className="sm-row-label"
                      value={r.label}
                      onChange={(v) => setRow(i, { ...r, label: v })}
                      placeholder="Label"
                    />
                    <Editable
                      className="sm-row-value"
                      value={r.value}
                      onChange={(v) => setRow(i, { ...r, value: v })}
                      placeholder="Value"
                    />
                    <button className="sm-row-remove" onClick={() => removeRow(i)} title="Remove row">×</button>
                  </div>
                ))}
                <button
                  className="sm-row-add"
                  onClick={addRow}
                  disabled={rowAddBlocked}
                  title={rowAddBlocked
                    ? "No more room — make the card taller or remove a row first."
                    : "Add a row"}
                >+ Add row</button>
              </div>

              {enabledIcons.length > 0 && (
                <div className="sm-icons">
                  {enabledIcons.map((k) => {
                    const meta = getIconMeta(k, t.customIcons);
                    if (!meta) return null;
                    const sz = sizeFor(k, t);
                    return (
                      <div
                        key={k}
                        className="sm-icon"
                        data-key={k}
                        title={`${meta.label} (${sz}mm)`}
                        style={{ width: `${sz}mm`, height: `${sz}mm` }}
                      >
                        {meta.svg
                          ? meta.svg
                          : <span style={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }}
                                  dangerouslySetInnerHTML={{ __html: meta.svgString || "" }} />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Barcode is OUTSIDE the body grid and absolutely positioned at
                bottom-right of the trim area, mirroring the PDF render. */}
            <div className="sm-barcode">
              <BarcodeView
                digits={t.ean13}
                heightMm={t.barcodeHeightMm}
                xDimMm={t.barcodeXDimMm}
              />
            </div>
          </div>

          {t.showTrimGuide && t.bleedMm > 0 && (
            <div className="sm-trim-guide" />
          )}
        </div>
      </div>

      {/* Welcome / sign-in overlay — locks the editor until a user is registered. */}
      {!user && <Welcome onSignIn={setUser} />}

      {/* Top header bar — branding, export menu, account chip. Lives
          OUTSIDE the Tweaks panel so it's always visible and present
          on every screen size. Moved here from the panel header
          (logo) + panel body (account chip) + panel export section,
          giving the Tweaks panel a single focused responsibility:
          editing the document. */}
      <HeaderBar
        user={user}
        onSignOut={handleSignOut}
        widthMm={t.widthMm}
        heightMm={t.heightMm}
        bleedMm={t.bleedMm}
        batchProgress={batchProgress}
        currentState={t}
        onApplyState={applyPresetState}
        onDownloadPdf={downloadPdf}
        onExportCsv={exportCsv}
        onImportCsv={() => csvInputRef.current?.click()}
        onBatchPdf={() => batchInputRef.current?.click()}
        onResetState={resetState}
      />

      <TweaksPanel>
        <TweakSection label="Size & bleed" />
        {/* Display-unit selector. Stored value stays in mm internally so
            the layout / PDF / presets are unit-stable; this only changes
            how the numbers are shown and entered in the W / H / Bleed
            inputs below. */}
        <TweakSelect
          label="Units"
          value={t.sizeUnit || "mm"}
          options={[
            { label: "Millimetres (mm)", value: "mm" },
            { label: "Centimetres (cm)", value: "cm" },
            { label: "Inches (in)",      value: "in" },
          ]}
          onChange={(v) => setTweak("sizeUnit", v)}
        />
        {(() => {
          const u = t.sizeUnit || "mm";
          const dp = UNIT_DECIMALS[u];
          const step = UNIT_STEP[u];
          const round = (n) => Number(n.toFixed(dp));
          return (
            <>
              <TweakNumber
                label={`Width (${unitLabel(u)})`}
                value={round(mmToUnit(t.widthMm, u))}
                min={round(mmToUnit(20, u))}
                max={round(mmToUnit(1000, u))}
                step={step}
                unit={unitLabel(u)}
                onChange={(v) => setTweak("widthMm", unitToMm(v, u))}
              />
              <TweakNumber
                label={`Height (${unitLabel(u)})`}
                value={round(mmToUnit(t.heightMm, u))}
                min={round(mmToUnit(20, u))}
                max={round(mmToUnit(1000, u))}
                step={step}
                unit={unitLabel(u)}
                onChange={(v) => setTweak("heightMm", unitToMm(v, u))}
              />
              <TweakSlider
                label="Bleed"
                value={round(mmToUnit(t.bleedMm, u))}
                min={0}
                max={round(mmToUnit(10, u))}
                step={u === "mm" ? 0.5 : step}
                unit={unitLabel(u)}
                onChange={(v) => setTweak("bleedMm", unitToMm(v, u))}
              />
            </>
          );
        })()}
        <TweakToggle label="Show trim guide (editor only)" value={t.showTrimGuide}
                     onChange={(v) => setTweak("showTrimGuide", v)} />
        <TweakToggle label="Crop marks in exported PDF" value={t.showCropMarks}
                     onChange={(v) => setTweak("showCropMarks", v)} />

        <TweakSection label="Brand" />
        <TweakText label="Brand name" value={t.brandName}
                   onChange={(v) => setTweak("brandName", v)} />
        <TweakButton label={t.brandLogo ? "Replace logo…" : "Upload logo…"} secondary
                     onClick={() => logoInputRef.current?.click()} />
        {t.brandLogo && (
          <TweakButton label="Remove logo" secondary
                       onClick={() => { setTweak("brandLogo", null); setTweak("brandLogoBw", false); }} />
        )}
        <input
          ref={logoInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={onPickLogo}
        />

        <TweakSection label="Content rows" />
        <div className="twk-tip" style={{ marginTop: 2 }}>
          Edit row label/value here, or click any text on the canvas
          preview to edit it inline. The order here = the order on the
          shipping mark.
        </div>
        {/* Inline rows table — each row is two text fields (label /
            value) plus a delete button. Keeps the rows discoverable
            and editable WITHOUT requiring the user to find the
            corresponding text on the canvas. */}
        <div className="vyke-rows-table">
          <div className="vyke-rows-head">
            <span>Label</span>
            <span>Value</span>
            <span aria-hidden="true" />
          </div>
          {(t.rows || []).map((row, i) => (
            <div className="vyke-rows-row" key={i}>
              <input
                type="text"
                className="twk-field"
                value={row.label || ""}
                placeholder="Label"
                onChange={(e) => setRow(i, { ...row, label: e.target.value })}
              />
              <input
                type="text"
                className="twk-field"
                value={row.value || ""}
                placeholder="Value"
                onChange={(e) => setRow(i, { ...row, value: e.target.value })}
              />
              <button
                type="button"
                className="vyke-rows-del"
                onClick={() => removeRow(i)}
                disabled={(t.rows || []).length <= 1}
                title={(t.rows || []).length <= 1 ? "Can't remove the last row" : "Remove this row"}
                aria-label="Remove row"
              >×</button>
            </div>
          ))}
        </div>
        <TweakButton
          label="+ Add row"
          onClick={addRow}
          secondary
          disabled={rowAddBlocked}
          title={rowAddBlocked
            ? "No more room on the card. Make it taller or remove a row first."
            : ""}
        />

        {/* "My presets" moved to the global header bar's Presets menu
            (HeaderBar component above), so save/load lives in one place. */}

        <TweakSection label="Barcode (EAN-13)" />
        <TweakText label="Digits (12 or 13)" value={t.ean13}
                   onChange={(v) => setTweak("ean13", v)} />
        <div className="twk-tip" style={{ marginTop: 4 }}>
          {normEan.ok
            ? <>
                ✓ <b>{normEan.digits}</b> — width {eanWidthMm.toFixed(1)} mm at xDim {t.barcodeXDimMm} mm<br/>
                <span style={{ opacity: 0.7, fontSize: "10.5px" }}>
                  Rendered by <b style={{ color: "#9DC9E8" }}>bwip-js</b> (BWIPP reference) → <b style={{ color: "#9DC9E8" }}>svg2pdf.js</b> — ISO/IEC 15420 compliant, true vector PDF.
                </span>
              </>
            : <>✗ <b style={{ color: "#ff8080" }}>{normEan.error}</b></>}
        </div>
        <div className="twk-tip" style={{ marginTop: 4 }}>
          The <b>EAN-13 barcode</b> is computed from your digits and validated
          live — enter 12 digits to auto-add the check digit, or 13 to validate.
          Bars are drawn as <b>true CMYK vector</b> in the PDF — never rasterised.
        </div>

        <TweakSection label="Handling icons" />
        <div className="twk-tip" style={{ marginTop: 2 }}>
          <b>ISO 780:2015 §3.4</b> recommends 100&nbsp;mm "normal" symbol height
          (150&nbsp;mm for Centre of Gravity), with smaller sizes permitted
          provided visibility is retained. Default (14&nbsp;mm) fits typical
          carton labels.
        </div>
        <TweakSlider
          label="Icon size"
          value={t.iconSizeMm || 14}
          min={6} max={50} step={0.5} unit="mm"
          onChange={(v) => setTweak("iconSizeMm", v)}
        />
        {/* Icon overflow warning is rendered OUTSIDE the Tweaks panel
            as a floating banner at the bottom of the canvas (see
            the <div className="vyke-canvas-warning"> below). Putting
            it on the canvas keeps the visual feedback close to where
            the actual clipping happens, instead of buried in the panel. */}
        {(t.iconSizeMm || 14) < 19 && !iconsDontFit && (
          <div className="twk-tip" style={{ borderColor: "rgba(255,180,80,.35)", background: "rgba(255,180,80,.06)" }}>
            ⚠︎ Below the ~19&nbsp;mm industry rule-of-thumb minimum — verify
            visibility on the package.
          </div>
        )}

        {/* Built-in icon toggles. Per-icon fine sizing lives in the
            Advanced section further down. */}
        {ICON_ORDER.map((k) => {
          const meta = window.ICON_LIBRARY[k];
          return (
            <TweakToggle
              key={k}
              label={meta.label}
              value={!!(t.icons && t.icons[k])}
              onChange={(v) => setTweak("icons", { ...(t.icons || {}), [k]: v })}
            />
          );
        })}

        {/* Custom uploaded icons in the toggle list. Per-icon size and remove
            still live here at compact size; finer sizing is in Advanced. */}
        {(t.customIcons || []).map((c) => (
          <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ flex: 1 }}>
              <TweakToggle
                label={`${c.label} (custom)`}
                value={!!(t.icons && t.icons[c.key])}
                onChange={(v) => setTweak("icons", { ...(t.icons || {}), [c.key]: v })}
              />
            </div>
            <button
              type="button"
              onClick={() => removeCustomIcon(c.key)}
              title="Remove this custom icon"
              style={{
                appearance: "none", border: 0, background: "rgba(255,255,255,0.06)",
                color: "rgba(255,255,255,0.55)", width: 22, height: 22, borderRadius: 6,
                cursor: "pointer", fontSize: 14, lineHeight: 1,
              }}
            >×</button>
          </div>
        ))}

        <TweakButton
          label="+ Upload custom icon (SVG)"
          onClick={() => iconInputRef.current?.click()}
          secondary
        />
        <input
          ref={iconInputRef}
          type="file"
          accept=".svg,image/svg+xml"
          style={{ display: "none" }}
          onChange={onPickIcon}
        />

        {/* ─── Advanced ────────────────────────────────────────────
            Expert settings — text size, B&W logo, barcode physical
            dimensions, per-icon size overrides. Used to live in a
            separate "pro" side-panel; now folded into the main
            sidebar as its own collapsible section so it sits with
            every other setting (logical placement). */}
        <TweakSection label="Advanced" />
        <div className="twk-sect" style={{ paddingTop: 0 }}>Row text size</div>
        <TweakSlider
          label="Text size"
          value={t.rowTextSizeMm || 2.6}
          min={1.5} max={6} step={0.1} unit="mm"
          onChange={(v) => setTweak("rowTextSizeMm", v)}
        />
        <div className="twk-tip">
          Default 2.6&nbsp;mm matches typical retail shipping marks. Larger
          text takes more vertical space; the canvas warning will tell you
          if rows no longer fit.
        </div>

        <div className="twk-sect">Logo</div>
        {t.brandLogo ? (
          <TweakToggle
            label="Force logo to pure black"
            value={t.brandLogoBw}
            onChange={(v) => setTweak("brandLogoBw", v)}
          />
        ) : (
          <div className="twk-tip" style={{ opacity: 0.65 }}>
            Upload a logo in the Brand section to enable B&amp;W filtering.
          </div>
        )}

        <div className="twk-sect">Barcode dimensions</div>
        <TweakSlider
          label="Bar height"
          value={t.barcodeHeightMm}
          min={8} max={40} step={0.5} unit="mm"
          onChange={(v) => setTweak("barcodeHeightMm", v)}
        />
        <TweakSlider
          label="X-dimension"
          value={t.barcodeXDimMm}
          min={0.264} max={0.660} step={0.01} unit="mm"
          onChange={(v) => setTweak("barcodeXDimMm", v)}
        />
        <div className="twk-tip">
          GS1 spec: 0.264 mm minimum, 0.330 mm default at 100&nbsp;%
          magnification. Larger X-dim = wider barcode and better scan distance.
        </div>

        <div className="twk-sect">Per-icon sizes</div>
        <div className="twk-tip">
          Override individual icons. Empty = use the global size
          ({(t.iconSizeMm || 14)}&nbsp;mm).
        </div>
        {enabledIcons.length === 0 && (
          <div className="twk-tip" style={{ opacity: 0.65 }}>
            No icons enabled yet — toggle some on in the Handling icons section.
          </div>
        )}
        {enabledIcons.map((k) => {
          const meta = getIconMeta(k, t.customIcons);
          if (!meta) return null;
          const override = t.iconSizesMm && t.iconSizesMm[k];
          const isCustom = !window.ICON_LIBRARY[k];
          return (
            <div key={k} className="adv-icon-row">
              <div className="adv-icon-thumb">
                {meta.svg
                  ? meta.svg
                  : <span style={{ width: 22, height: 22, display: "grid", placeItems: "center" }}
                          dangerouslySetInnerHTML={{ __html: meta.svgString || "" }} />}
              </div>
              <div className="adv-icon-meta">
                <div className="adv-icon-label">{meta.label}</div>
                <div className="adv-icon-iso">
                  {isCustom
                    ? "Custom upload"
                    : <>{meta.iso} · ISO normal {meta.isoNormalMm}&nbsp;mm</>}
                </div>
              </div>
              <input
                type="text"
                inputMode="decimal"
                className="twk-field adv-icon-input"
                placeholder={String(t.iconSizeMm || 14)}
                value={override == null ? "" : String(override)}
                onChange={(e) => {
                  const s = e.target.value.trim();
                  const next = { ...(t.iconSizesMm || {}) };
                  if (s === "") {
                    delete next[k];
                  } else {
                    const n = Number(s);
                    if (Number.isFinite(n) && n > 0) next[k] = n;
                  }
                  setTweak("iconSizesMm", next);
                }}
              />
              <span className="adv-icon-unit">mm</span>
            </div>
          );
        })}
        {Object.keys(t.iconSizesMm || {}).length > 0 && (
          <TweakButton
            label="Reset all overrides"
            secondary
            onClick={() => setTweak("iconSizesMm", {})}
          />
        )}

        {/* Export actions moved to the top header bar's ⬇ Export menu.
            The hidden file <input>s for CSV/batch upload stay here
            because the header's menu items click them via refs. */}
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) importCsv(f);
          }}
        />
        <input
          ref={batchInputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) batchPdf(f);
          }}
        />

        {/* The 'Tip' section that used to sit here has been broken
            up — its barcode-related text moved into the Barcode
            section above (so users see it WHILE editing the EAN),
            and the CSV / batch reminder is no longer needed since
            those actions live in the header's Export menu. */}

        <div className="twk-footer">powered by Xafai</div>
      </TweaksPanel>

      {/* Advanced side-panel removed in favour of an inline 'Advanced'
          collapsible section inside the main sidebar (see TweaksPanel
          above). The expert settings now sit alongside every other
          group instead of behind a separate popout. */}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
