// presets-panel.jsx — "My presets" section inside the Tweaks panel.
//
// Lets the signed-in user:
//   - save the current editor state as a named preset (with a small
//     thumbnail rendered via html2canvas)
//   - browse their saved presets (thumbnail + name + relative timestamp)
//   - load a preset back into the editor (applies every state key)
//   - delete a preset
//
// All persistence goes through window.PRESETS — Supabase when configured,
// localStorage when not.

(function () {
  const { useState, useEffect, useCallback } = React;

  // Pretty "5 min ago" relative timestamp for the list rows.
  function timeAgo(iso) {
    if (!iso) return "";
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return "";
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60)  return s + "s ago";
    const m = Math.floor(s / 60);
    if (m < 60)  return m + " min ago";
    const h = Math.floor(m / 60);
    if (h < 24)  return h + " hr ago";
    const d = Math.floor(h / 24);
    if (d < 30)  return d + " day" + (d === 1 ? "" : "s") + " ago";
    const mo = Math.floor(d / 30);
    if (mo < 12) return mo + " mo ago";
    return Math.floor(mo / 12) + " yr ago";
  }

  // Snap a small thumbnail of the current shipping-mark element. Capped at
  // ~140px wide PNG to keep preset rows tiny.
  async function snapThumbnail() {
    const card = document.querySelector(".shipping-mark");
    if (!card || !window.html2canvas) return null;
    try {
      const canvas = await window.html2canvas(card, {
        scale: 0.5, backgroundColor: "#ffffff", logging: false, useCORS: true,
      });
      // Downscale further to a max width of 140px via a second canvas
      const maxW = 140;
      if (canvas.width <= maxW) return canvas.toDataURL("image/png");
      const ratio = maxW / canvas.width;
      const out = document.createElement("canvas");
      out.width = maxW;
      out.height = Math.round(canvas.height * ratio);
      const ctx = out.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(canvas, 0, 0, out.width, out.height);
      return out.toDataURL("image/png");
    } catch (e) {
      console.warn("[Vyke Create] thumbnail render failed:", e);
      return null;
    }
  }

  window.PresetsPanel = function PresetsPanel({ user, currentState, onApplyState }) {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [saveName, setSaveName] = useState("");
    const [error, setError] = useState("");

    const refresh = useCallback(async () => {
      if (!user) return;
      setLoading(true);
      try {
        const list = await window.PRESETS.list(user.id);
        setItems(list);
      } catch (e) {
        setError(e?.message || "Couldn't load your presets.");
      } finally {
        setLoading(false);
      }
    }, [user]);

    useEffect(() => { refresh(); }, [refresh]);

    const onSave = useCallback(async () => {
      setError("");
      const proposed = saveName.trim() || (currentState.brandName || "Untitled preset");
      setBusy(true);
      try {
        // Render thumbnail BEFORE Supabase call so a slow network doesn't
        // race the user's next edit.
        const thumb = await snapThumbnail();
        const saved = await window.PRESETS.save(user.id, proposed, currentState, thumb);
        window.ACTIVITY.log("preset_saved", {
          preset_id: saved.id, preset_name: saved.name,
          width_mm: currentState.widthMm, height_mm: currentState.heightMm,
          is_new: saved.isNew,
        });
        setSaveName("");
        await refresh();
      } catch (e) {
        setError(e?.message || "Couldn't save the preset.");
      } finally {
        setBusy(false);
      }
    }, [user, saveName, currentState, refresh]);

    const onLoad = useCallback(async (preset) => {
      setError("");
      setBusy(true);
      try {
        const full = await window.PRESETS.load(preset.id);
        if (!full || !full.state) throw new Error("Preset is empty or unreadable.");
        onApplyState(full.state);
        window.ACTIVITY.log("preset_loaded", {
          preset_id: preset.id, preset_name: preset.name,
        });
      } catch (e) {
        setError(e?.message || "Couldn't load that preset.");
      } finally {
        setBusy(false);
      }
    }, [onApplyState]);

    const onDelete = useCallback(async (preset) => {
      if (!window.confirm(`Delete preset "${preset.name}"? This cannot be undone.`)) return;
      setBusy(true);
      try {
        await window.PRESETS.delete(preset.id, user.id);
        window.ACTIVITY.log("preset_deleted", {
          preset_id: preset.id, preset_name: preset.name,
        });
        await refresh();
      } catch (e) {
        setError(e?.message || "Couldn't delete the preset.");
      } finally {
        setBusy(false);
      }
    }, [user, refresh]);

    return (
      <>
        <div className="twk-tip" style={{ marginTop: 2 }}>
          {items.length === 0 && !loading
            ? <>No presets yet — save your current setup to reuse it later.</>
            : <>{items.length} saved preset{items.length === 1 ? "" : "s"}.</>}
        </div>

        <div className="vyke-pre-saverow">
          <input
            type="text"
            className="twk-field vyke-pre-savename"
            placeholder="Preset name (optional)"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            disabled={busy}
            maxLength={80}
          />
          <button
            type="button"
            className="twk-btn vyke-pre-savebtn"
            onClick={onSave}
            disabled={busy}
            title="Save the current shipping mark as a preset"
          >
            {busy ? "Saving…" : "+ Save"}
          </button>
        </div>

        {error && <div className="vyke-pre-error">{error}</div>}

        <div className="vyke-pre-list">
          {loading && <div className="vyke-pre-empty">Loading…</div>}
          {!loading && items.length === 0 && (
            <div className="vyke-pre-empty">
              Your saved presets will show up here.
            </div>
          )}
          {items.map((p) => (
            <div key={p.id} className="vyke-pre-row">
              <div className="vyke-pre-thumb">
                {p.thumbnail
                  ? <img src={p.thumbnail} alt="" />
                  : <div className="vyke-pre-thumb-fallback">SM</div>}
              </div>
              <div className="vyke-pre-meta">
                <div className="vyke-pre-name" title={p.name}>{p.name}</div>
                <div className="vyke-pre-time">{timeAgo(p.updated_at)}</div>
              </div>
              <button
                type="button"
                className="vyke-pre-load"
                onClick={() => onLoad(p)}
                disabled={busy}
                title="Load this preset"
              >Load</button>
              <button
                type="button"
                className="vyke-pre-del"
                onClick={() => onDelete(p)}
                disabled={busy}
                title="Delete this preset"
              >×</button>
            </div>
          ))}
        </div>
      </>
    );
  };
})();
