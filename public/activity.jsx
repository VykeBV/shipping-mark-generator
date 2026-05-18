// activity.jsx — fire-and-forget activity logger.
//
// Every meaningful user action is logged so the admin (Tim) can see what
// people are doing with the tool. Calls NEVER block the UI: any failure
// (offline, Supabase down, quota) is swallowed so the editor stays
// snappy. Online → inserts into the Supabase `activity_log` table.
// Offline → appends to a capped localStorage buffer (so we can replay it
// later or just for local debugging).

(function () {
  const OFFLINE_KEY = "vyke-offline-activity-v1";
  const OFFLINE_CAP = 500;  // ring-buffer cap to avoid filling localStorage

  function offlineAppend(entry) {
    try {
      const arr = JSON.parse(localStorage.getItem(OFFLINE_KEY) || "[]");
      arr.unshift(entry);
      if (arr.length > OFFLINE_CAP) arr.length = OFFLINE_CAP;
      localStorage.setItem(OFFLINE_KEY, JSON.stringify(arr));
    } catch { /* quota — silently drop */ }
  }

  window.ACTIVITY = {
    // Fire-and-forget. `kind` is required, `payload` is any small JSON-able
    // object. The current user is read from AUTH; if no one is signed in
    // the call is dropped (we don't track anonymous activity in v1).
    log(kind, payload) {
      if (!kind) return;
      const user = window.AUTH && window.AUTH.getCurrentUser();
      if (!user) return;
      const entry = {
        user_id: user.id,
        kind: String(kind),
        payload: payload || null,
      };
      if (window.SUPABASE) {
        window.SUPABASE.from("activity_log").insert(entry).then(() => {}, (err) => {
          console.warn("[Vyke Create] activity.log failed:", err);
          offlineAppend({ ...entry, created_at: new Date().toISOString(), offline: true });
        });
      } else {
        offlineAppend({ ...entry, created_at: new Date().toISOString() });
      }
    },

    // Read the offline buffer — handy for local debugging via DevTools.
    readOffline() {
      try { return JSON.parse(localStorage.getItem(OFFLINE_KEY) || "[]"); }
      catch { return []; }
    },
  };
})();
