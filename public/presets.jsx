// presets.jsx — save/list/load/delete shipping-mark presets.
//
// A preset is a full snapshot of the editor's `t` state object (the
// DEFAULTS shape from app.jsx — size, rows, EAN-13, icons, logo dataURL,
// custom-icon SVGs, …) plus a small thumbnail PNG dataURL for the list
// view. Online → stored in the Supabase `presets` table with `user_id`
// foreign key. Offline → stored under a per-user key in localStorage so
// browser sessions are still useful.

(function () {
  const OFFLINE_PREFIX = "vyke-offline-presets-v1:"; // + userId

  // ── Offline storage helpers ────────────────────────────────────────
  const offlineKey = (userId) => OFFLINE_PREFIX + userId;
  function readOffline(userId) {
    try { return JSON.parse(localStorage.getItem(offlineKey(userId)) || "[]"); }
    catch { return []; }
  }
  function writeOffline(userId, list) {
    try { localStorage.setItem(offlineKey(userId), JSON.stringify(list)); }
    catch (e) {
      // Most likely localStorage quota — bubble a clear error so the UI
      // can show the user.
      throw new Error("Browser storage is full — couldn't save the preset.");
    }
  }
  function offlineUuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // ── Public API ─────────────────────────────────────────────────────
  window.PRESETS = {
    // Returns [{id, name, updated_at, thumbnail}] sorted newest-first.
    async list(userId) {
      if (!userId) return [];
      if (window.SUPABASE) {
        try {
          const { data, error } = await window.SUPABASE
            .from("presets")
            .select("id, name, updated_at, thumbnail")
            .eq("user_id", userId)
            .order("updated_at", { ascending: false });
          if (error) throw error;
          return data || [];
        } catch (e) {
          console.warn("[Vyke Create] Supabase list failed, falling back to offline:", e);
          // fall through to offline read
        }
      }
      const list = readOffline(userId);
      return list
        .map(({ id, name, updated_at, thumbnail }) => ({ id, name, updated_at, thumbnail }))
        .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    },

    // Returns the full preset row including `state`. Null if not found.
    async load(presetId) {
      if (!presetId) return null;
      if (window.SUPABASE) {
        try {
          const { data, error } = await window.SUPABASE
            .from("presets").select("*").eq("id", presetId).maybeSingle();
          if (error) throw error;
          return data;
        } catch (e) {
          console.warn("[Vyke Create] Supabase load failed, trying offline:", e);
        }
      }
      // Offline lookup — we don't know whose preset it is, so scan all
      // matching offline keys. In practice this is always the current user.
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(OFFLINE_PREFIX)) continue;
        try {
          const list = JSON.parse(localStorage.getItem(k) || "[]");
          const hit = list.find((p) => p.id === presetId);
          if (hit) return hit;
        } catch {}
      }
      return null;
    },

    // Upserts by (userId, name): saving with an existing name overwrites
    // that preset's state + thumbnail in place. New name → new row.
    async save(userId, name, state, thumbnailDataUrl) {
      if (!userId) throw new Error("Not signed in.");
      if (!name || !name.trim()) throw new Error("Preset needs a name.");
      const trimName = name.trim().slice(0, 80);
      const nowIso = new Date().toISOString();
      if (window.SUPABASE) {
        try {
          // Look for an existing preset with the same (user_id, name)
          const { data: existing } = await window.SUPABASE
            .from("presets").select("id")
            .eq("user_id", userId).eq("name", trimName).maybeSingle();
          if (existing) {
            const { data, error } = await window.SUPABASE
              .from("presets")
              .update({ state, thumbnail: thumbnailDataUrl, updated_at: nowIso })
              .eq("id", existing.id)
              .select().single();
            if (error) throw error;
            return { id: data.id, name: trimName, isNew: false };
          }
          const { data, error } = await window.SUPABASE
            .from("presets")
            .insert({ user_id: userId, name: trimName, state, thumbnail: thumbnailDataUrl })
            .select().single();
          if (error) throw error;
          return { id: data.id, name: trimName, isNew: true };
        } catch (e) {
          console.warn("[Vyke Create] Supabase save failed, falling back to offline:", e);
          // fall through to offline write
        }
      }
      const list = readOffline(userId);
      const existing = list.find((p) => p.name === trimName);
      if (existing) {
        existing.state = state;
        existing.thumbnail = thumbnailDataUrl;
        existing.updated_at = nowIso;
        writeOffline(userId, list);
        return { id: existing.id, name: trimName, isNew: false };
      }
      const id = offlineUuid();
      list.unshift({
        id, user_id: userId, name: trimName,
        state, thumbnail: thumbnailDataUrl,
        created_at: nowIso, updated_at: nowIso,
      });
      writeOffline(userId, list);
      return { id, name: trimName, isNew: true };
    },

    async delete(presetId, userId) {
      if (!presetId) return;
      if (window.SUPABASE) {
        try {
          const { error } = await window.SUPABASE
            .from("presets").delete().eq("id", presetId);
          if (error) throw error;
          return;
        } catch (e) {
          console.warn("[Vyke Create] Supabase delete failed, trying offline:", e);
        }
      }
      if (!userId) return;
      const list = readOffline(userId).filter((p) => p.id !== presetId);
      writeOffline(userId, list);
    },
  };
})();
