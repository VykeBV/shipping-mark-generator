// config.jsx — Supabase project settings + admin allow-list.
//
// ─── How to switch on real Supabase persistence ────────────────────────────
// While `url` is empty, the app runs in OFFLINE MODE: accounts, presets and
// the activity log all use the browser's localStorage. This is intentional
// so the editor is fully usable for development and for any visitor who lands
// on the page before Tim has wired up Supabase.
//
// To switch to real Supabase:
//   1. Sign in at https://supabase.com and create a project.
//   2. SQL Editor → paste & run the schema block from the plan
//      (see /Users/timmuller/.claude/plans/i-want-to-create-lovely-lagoon.md
//      under "Database schema").
//   3. Project Settings → API → copy the **Project URL** and the **anon
//      public** key (NOT the service-role key — that one must never be
//      committed; the anon key is safe in the client).
//   4. Paste them into the two strings below and refresh.
//
// As soon as both `url` and `anonKey` are non-empty, auth.jsx / presets.jsx
// / activity.jsx automatically route every call to Supabase instead of
// localStorage. Any existing localStorage data is left alone (so a single
// browser can keep working offline-style if Supabase ever goes away).

window.SUPABASE_CONFIG = {
  url: "",          // e.g. "https://abcdefghij.supabase.co"
  anonKey: "",      // e.g. "eyJhbGciOi..."

  // Emails listed here see admin-only affordances (currently none, but
  // reserved for a future "Open admin" link to the Supabase dashboard).
  adminEmails: ["tim@vyke.design"],
};

// Build the Supabase client lazily — only if both URL and key are present
// AND the JS SDK has loaded from the CDN. Modules check `window.SUPABASE`
// at call time, so a missing client just routes calls to the localStorage
// fallback paths.
(function initSupabase() {
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg.url || !cfg.anonKey) {
    window.SUPABASE = null;
    console.info("[Vyke Create] Running in OFFLINE mode — fill in config.jsx to enable Supabase sync.");
    return;
  }
  if (!window.supabase || !window.supabase.createClient) {
    console.warn("[Vyke Create] Supabase SDK not loaded; falling back to OFFLINE mode.");
    window.SUPABASE = null;
    return;
  }
  try {
    window.SUPABASE = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: false },  // we manage identity ourselves via localStorage
    });
    console.info("[Vyke Create] Supabase client ready.");
  } catch (e) {
    console.error("[Vyke Create] Failed to init Supabase client; falling back to OFFLINE.", e);
    window.SUPABASE = null;
  }
})();
