// welcome.jsx — first-visit "register your email" overlay.
//
// Renders an undismissable centred card over the editor until the visitor
// has registered (or signed back in). The editor itself is rendered behind
// it, slightly blurred + dimmed, so visitors can see what the tool is
// before committing their email — but they can't interact with it.
//
// On submit:
//   - validates the email client-side (no verification email)
//   - calls AUTH.getOrCreateUser → either looks up by email or inserts
//   - fires ACTIVITY.log('signup') or 'signin' accordingly
//   - calls props.onSignIn(user) so App can render the full editor

(function () {
  const { useState, useRef, useEffect } = React;

  window.Welcome = function Welcome({ onSignIn }) {
    const [email, setEmail] = useState("");
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const emailRef = useRef(null);

    useEffect(() => { if (emailRef.current) emailRef.current.focus(); }, []);

    const submit = async (e) => {
      if (e) e.preventDefault();
      setError("");
      if (!window.AUTH.isEmail(email)) {
        setError("That doesn't look like a valid email address.");
        return;
      }
      setBusy(true);
      try {
        const { user, isNew } = await window.AUTH.getOrCreateUser(email, name);
        window.ACTIVITY.log(isNew ? "signup" : "signin", {
          ua: navigator.userAgent.slice(0, 200),
          referrer: document.referrer.slice(0, 200),
        });
        onSignIn(user);
      } catch (e) {
        setError(e && e.message ? e.message : "Something went wrong — please try again.");
      } finally {
        setBusy(false);
      }
    };

    const online = window.AUTH.isOnline();

    return (
      <div className="vyke-welcome-backdrop">
        <form className="vyke-welcome-card" onSubmit={submit}>
          <div className="vyke-welcome-hd">
            <div className="vyke-welcome-logo" aria-hidden="true" />
            <div className="vyke-welcome-eyebrow">Vyke Create · Shipping Marks</div>
            <h1 className="vyke-welcome-title">Welcome</h1>
            <p className="vyke-welcome-intro">
              Generate print-ready shipping mark PDFs with vector-precise EAN-13
              barcodes and official ISO 7000 handling icons. Save your designs
              as presets so you can pick them up next time.
            </p>
          </div>

          <div className="vyke-welcome-body">
            <label className="vyke-welcome-lbl">
              Email
              <input
                ref={emailRef}
                type="email"
                className="vyke-welcome-field"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                disabled={busy}
                required
              />
            </label>
            <label className="vyke-welcome-lbl">
              Your name <span className="vyke-welcome-optional">(optional)</span>
              <input
                type="text"
                className="vyke-welcome-field"
                placeholder="How should we greet you?"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                disabled={busy}
                maxLength={60}
              />
            </label>

            {error && <div className="vyke-welcome-error">{error}</div>}

            <button
              type="submit"
              className="vyke-welcome-cta"
              disabled={busy || !email}
            >
              {busy ? "One moment…" : "Continue →"}
            </button>

            <div className="vyke-dev-notice">
              <span className="vyke-dev-notice-icon" aria-hidden="true">🚧</span>
              <b>Heads up — this tool is still in active development.</b>
              {" "}You may be using it while we're shipping changes, so
              some features might not behave cleanly yet. If something
              breaks, please let us know.
            </div>

            <div className="vyke-welcome-fineprint">
              No password. We use your email to remember your presets and
              recognise you when you come back.
              {!online && (
                <>
                  {" "}
                  <b style={{ color: "#FFD27F" }}>Test build:</b> data is currently
                  saved only on this device.
                </>
              )}
            </div>

            <div className="vyke-welcome-footer">
              Powered by <b>Xafai</b>
            </div>
          </div>
        </form>
      </div>
    );
  };
})();
