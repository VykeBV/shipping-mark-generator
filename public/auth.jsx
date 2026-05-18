// auth.jsx — passwordless identity for the Shipping Mark Generator.
//
// Identity model: the user is identified by their email. There is no
// password and no verification. When they type their email into the welcome
// modal we look up the row in `users` (or insert one), persist the user
// row to localStorage as the "session", and the app then attributes every
// action (preset_saved, pdf_exported, …) to that user.
//
// When `window.SUPABASE` is null (config.jsx in OFFLINE mode) every call
// degrades to localStorage — the editor stays fully usable but the data
// never leaves the browser. This lets us ship UI without first wiring up
// the Supabase project and lets developers preview without credentials.

(function () {
  const STORAGE_KEY = "vyke-account-v1";
  // Mirror of the cloud `users` table, used in OFFLINE mode only.
  const OFFLINE_USERS_KEY = "vyke-offline-users-v1";

  const isEmail = (s) =>
    typeof s === "string" && /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(s.trim());

  // ── Local session (localStorage) ───────────────────────────────────
  function readSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.id || !obj.email) return null;
      return obj;
    } catch (e) { return null; }
  }
  function writeSession(user) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(user)); }
    catch (e) { /* quota — ignore */ }
  }
  function clearSession() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  // ── Offline (localStorage) user table ──────────────────────────────
  function readOfflineUsers() {
    try { return JSON.parse(localStorage.getItem(OFFLINE_USERS_KEY) || "[]"); }
    catch { return []; }
  }
  function writeOfflineUsers(list) {
    try { localStorage.setItem(OFFLINE_USERS_KEY, JSON.stringify(list)); }
    catch {}
  }
  function offlineUuid() {
    // Crypto.randomUUID is in every modern browser; fallback for older.
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  async function offlineGetOrCreate(email, displayName) {
    const list = readOfflineUsers();
    const norm = email.trim().toLowerCase();
    let row = list.find((u) => u.email.toLowerCase() === norm);
    let isNew = false;
    if (!row) {
      row = {
        id: offlineUuid(),
        email: email.trim(),
        display_name: displayName || email.trim().split("@")[0],
        created_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      };
      list.push(row);
      writeOfflineUsers(list);
      isNew = true;
    } else {
      row.last_seen_at = new Date().toISOString();
      if (displayName && displayName !== row.display_name) row.display_name = displayName;
      writeOfflineUsers(list);
    }
    return { user: row, isNew };
  }

  // ── Supabase ───────────────────────────────────────────────────────
  async function supabaseGetOrCreate(email, displayName) {
    const sb = window.SUPABASE;
    const norm = email.trim().toLowerCase();
    // 1. Try to find existing
    const { data: existing, error: selErr } = await sb
      .from("users").select("id, email, display_name, created_at, last_seen_at")
      .ilike("email", norm).limit(1).maybeSingle();
    if (selErr) throw selErr;
    if (existing) {
      // Touch last_seen_at — fire-and-forget, don't block the welcome flow.
      sb.from("users").update({ last_seen_at: new Date().toISOString() })
        .eq("id", existing.id).then(() => {}, () => {});
      return { user: existing, isNew: false };
    }
    // 2. Insert
    const insertRow = {
      email: email.trim(),
      display_name: displayName || email.trim().split("@")[0],
    };
    const { data: created, error: insErr } = await sb
      .from("users").insert(insertRow).select().single();
    if (insErr) throw insErr;
    return { user: created, isNew: true };
  }

  // ── Public surface ─────────────────────────────────────────────────
  window.AUTH = {
    isEmail,

    // Returns { user, isNew }. Throws on bad email; on Supabase failure
    // automatically falls back to the offline path so the user can still
    // proceed (a banner can surface the network warning separately).
    async getOrCreateUser(email, displayName) {
      if (!isEmail(email)) throw new Error("Please enter a valid email address.");
      let result;
      if (window.SUPABASE) {
        try { result = await supabaseGetOrCreate(email, displayName); }
        catch (e) {
          console.warn("[Vyke Create] Supabase auth failed, using offline fallback:", e);
          result = await offlineGetOrCreate(email, displayName);
        }
      } else {
        result = await offlineGetOrCreate(email, displayName);
      }
      writeSession(result.user);
      return result;
    },

    getCurrentUser: readSession,

    clearAccount: clearSession,

    // Fire-and-forget touch on every cold start of the app for returning
    // users. Updates last_seen_at; failures swallowed.
    touchLastSeen(userId) {
      if (window.SUPABASE && userId) {
        window.SUPABASE.from("users")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", userId).then(() => {}, () => {});
      } else {
        // Offline mirror update.
        const list = readOfflineUsers();
        const row = list.find((u) => u.id === userId);
        if (row) { row.last_seen_at = new Date().toISOString(); writeOfflineUsers(list); }
      }
    },

    // Used by the eventual /admin link — for now only checks whether the
    // signed-in user's email is on the allow-list.
    isAdmin(user) {
      if (!user || !user.email) return false;
      const allow = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.adminEmails) || [];
      return allow.some((e) => e.toLowerCase() === user.email.toLowerCase());
    },

    // True when running against a real Supabase project; useful for the UI
    // to label things "saved to your account" vs "saved on this device".
    isOnline() { return !!window.SUPABASE; },
  };
})();
