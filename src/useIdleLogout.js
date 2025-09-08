export default function useIdleLogout({ enabled = true, ms = 30 * 60 * 1000, onLogout }) {
  React.useEffect(() => {
    if (!enabled) return;

    let timerId = null;
    let last = Date.now();

    // Cross-tab channel
    let bc = null;
    try { bc = new BroadcastChannel("auth-events"); } catch (_) {}

    const doLogoutEverywhere = async () => {
      try {
        onLogout && (await onLogout());
      } finally {
        // notify other tabs
        try { bc?.postMessage("force-logout"); } catch (_) {}
        // localStorage ping fallback
        try { localStorage.setItem("__force_logout__", String(Date.now())); } catch (_) {}
      }
    };

    const reset = () => {
      last = Date.now();
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(check, ms + 1000);
    };

    const check = () => {
      if (Date.now() - last >= ms) {
        doLogoutEverywhere();
      } else {
        reset();
      }
    };

    const onActivity = () => reset();

    const onVisibility = () => {
      // If user returns and has been away longer than ms, logout immediately
      if (document.visibilityState === "visible" && Date.now() - last >= ms) {
        doLogoutEverywhere();
      } else {
        reset();
      }
    };

    // Listen for user activity
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", onVisibility);

    // Cross-tab listeners
    const onBc = (e) => { if (e?.data === "force-logout") doLogoutEverywhere(); };
    try { bc && (bc.onmessage = onBc); } catch (_) {}
    const onStorage = (e) => { if (e.key === "__force_logout__") doLogoutEverywhere(); };
    window.addEventListener("storage", onStorage);

    // start the timer
    reset();

    return () => {
      if (timerId) clearTimeout(timerId);
      events.forEach((ev) => window.removeEventListener(ev, onActivity));
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
      try { bc && bc.close(); } catch (_) {}
    };
  }, [enabled, ms, onLogout]);
}