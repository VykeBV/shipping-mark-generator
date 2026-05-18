// account-chip.jsx — signed-in user chip shown at the top of the Tweaks
// panel body. Click → small popover with email + "Sign out".

(function () {
  const { useState, useRef, useEffect } = React;

  window.AccountChip = function AccountChip({ user, onSignOut }) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);
    const online = window.AUTH.isOnline();
    const displayName = user.display_name || user.email.split("@")[0];

    useEffect(() => {
      if (!open) return;
      const onDocClick = (e) => {
        if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
      };
      document.addEventListener("mousedown", onDocClick);
      return () => document.removeEventListener("mousedown", onDocClick);
    }, [open]);

    return (
      <div className="vyke-acc-wrap" ref={wrapRef}>
        <button
          type="button"
          className="vyke-acc-chip"
          aria-expanded={open ? "true" : "false"}
          onClick={() => setOpen((v) => !v)}
          title={user.email}
        >
          <span className="vyke-acc-avatar" aria-hidden="true">
            {displayName.charAt(0).toUpperCase()}
          </span>
          <span className="vyke-acc-name">{displayName}</span>
          <span
            className="vyke-acc-dot"
            data-online={online ? "1" : "0"}
            title={online ? "Synced to your account" : "Saved on this device only"}
            aria-hidden="true"
          />
        </button>
        {open && (
          <div className="vyke-acc-pop" role="menu">
            <div className="vyke-acc-pop-email">{user.email}</div>
            <div className="vyke-acc-pop-status">
              {online
                ? "Synced to your account"
                : "Saved on this device only (test build)"}
            </div>
            <button
              type="button"
              className="vyke-acc-pop-action"
              onClick={() => { setOpen(false); onSignOut(); }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    );
  };
})();
