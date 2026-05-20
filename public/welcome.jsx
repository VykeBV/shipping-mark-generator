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
        {/* Two-column card on desktop (>=760 px viewport width):
            LEFT  — branding context (logo, title, intro, "For your
                    company" pitch, dev notice)
            RIGHT — the action (email/name fields, continue, fineprint,
                    footer credit)
            Stacks vertically on narrow viewports — same content order.
            This makes the card shorter on desktop so it fits inside
            the available viewport height without scrolling. */}
        <form className="vyke-welcome-card" onSubmit={submit}>
          <div className="vyke-welcome-left">
            <div className="vyke-welcome-logo" aria-hidden="true" />
            <div className="vyke-welcome-eyebrow">
              Vyke Create · Shipping Marks
              <span className="vyke-welcome-demo-chip">Free demo</span>
            </div>
            <h1 className="vyke-welcome-title">Try the generator</h1>
            <p className="vyke-welcome-intro">
              This is a <b>free public demo</b> of what Vyke can build — a
              showcase, not a production tool. Generate print-ready shipping
              mark PDFs with vector-precise EAN-13 barcodes and official ISO
              7000 handling icons, and save your designs as presets so you
              can pick them up next time.
            </p>

            <div className="vyke-welcome-pitch">
              <div className="vyke-welcome-pitch-eyebrow">For your company</div>
              <div className="vyke-welcome-pitch-title">
                Want this in your own branding?
              </div>
              <p className="vyke-welcome-pitch-body">
                We can build this for <b>product cards, flyers, labels</b>,
                you name it — in your house style, and even
                <b> automate the whole flow</b> so your team never opens
                a PDF editor again.
              </p>
              <a
                className="vyke-welcome-pitch-cta"
                href="mailto:tim@vyke.design?subject=Custom%20Vyke%20Create%20build"
              >
                Email tim@vyke.design →
              </a>
            </div>

            <div className="vyke-dev-notice">
              <span className="vyke-dev-notice-icon" aria-hidden="true">🚧</span>
              <b>Heads up — this demo is still in active development.</b>
              {" "}You may be using it while we're shipping changes, so
              some features might not behave cleanly yet. If something
              breaks, please let us know.
            </div>
          </div>

          <div className="vyke-welcome-right">
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

            {/* Marketing-consent line — kept tight and adjacent to the
                CTA so it's seen BEFORE the click that constitutes
                consent. Separate from the fineprint below (which is
                about how the email is used for sign-in) so the
                contact-permission scope reads as its own clear item. */}
            <div className="vyke-welcome-consent">
              By continuing you agree that Vyke may email you with
              product updates and occasionally contact you about your
              use of this demo.
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
