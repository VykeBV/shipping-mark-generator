// feedback.jsx — quick in-app feedback capture.
//
// Exposes:
//   window.FEEDBACK.submit({ message, user })  →  Promise<{ ok, id?, error? }>
//
// Behaviour:
//   - When Supabase is wired up (window.SUPABASE truthy), writes one row to
//     the `feedback` table. The table schema we expect:
//
//       create table feedback (
//         id          bigserial primary key,
//         user_id     uuid references users(id) on delete set null,
//         email       text,
//         message     text not null,
//         created_at  timestamptz not null default now(),
//         meta        jsonb
//       );
//
//     (RLS off for v1, same trust model as the other tables.)
//
//   - When Supabase is NOT wired (or the call errors), falls back to a
//     localStorage ring buffer at `vyke-offline-feedback-v1`. Tim can still
//     see captured feedback by opening DevTools and inspecting that key,
//     and any future "drain offline feedback" job could resync them.
//
// Always fires ACTIVITY.log('feedback_submitted') for cross-table audit.

(function () {
  const OFFLINE_KEY = "vyke-offline-feedback-v1";
  const MAX_OFFLINE = 200;

  function pushOffline(entry) {
    try {
      const raw = localStorage.getItem(OFFLINE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      list.push(entry);
      while (list.length > MAX_OFFLINE) list.shift();
      localStorage.setItem(OFFLINE_KEY, JSON.stringify(list));
    } catch (e) { /* quota / sandbox — swallow */ }
  }

  async function submit({ message, user }) {
    const msg = String(message || "").trim();
    if (!msg) return { ok: false, error: "Message can't be empty." };

    const entry = {
      user_id: user?.id || null,
      email: user?.email || null,
      message: msg.slice(0, 4000),
      meta: {
        ua: navigator.userAgent.slice(0, 240),
        url: location.href.slice(0, 240),
        ts: Date.now(),
      },
    };

    const sb = window.SUPABASE;
    if (sb) {
      try {
        const { data, error } = await sb
          .from("feedback")
          .insert(entry)
          .select("id")
          .single();
        if (error) throw error;
        if (window.ACTIVITY) {
          window.ACTIVITY.log("feedback_submitted", {
            feedback_id: data?.id, length: entry.message.length,
          });
        }
        return { ok: true, id: data?.id };
      } catch (err) {
        console.warn("[Vyke Create] feedback Supabase insert failed; saving offline.", err);
        pushOffline({ ...entry, created_at: new Date().toISOString(), _err: err?.message || String(err) });
        if (window.ACTIVITY) {
          window.ACTIVITY.log("feedback_submitted", {
            offline: true, length: entry.message.length,
          });
        }
        // We still report ok=true to the user — their message is captured,
        // just on this device instead of in Supabase. Tim can drain it later.
        return { ok: true, offline: true };
      }
    }

    // No Supabase configured at all → straight to offline.
    pushOffline({ ...entry, created_at: new Date().toISOString() });
    if (window.ACTIVITY) {
      window.ACTIVITY.log("feedback_submitted", {
        offline: true, length: entry.message.length,
      });
    }
    return { ok: true, offline: true };
  }

  window.FEEDBACK = { submit };
})();
