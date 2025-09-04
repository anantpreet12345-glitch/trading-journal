import { useEffect, useRef } from "react";

/** Auto-logout after inactivity (works across tabs) */
export function useIdleLogout({
  enabled = true,
  timeoutMs = 15 * 60 * 1000, // default 15 min
  onTimeout,
  storageKey = "last-activity",
}) {
  const timerRef = useRef(null);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const resetTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (!firedRef.current) {
          firedRef.current = true;
          onTimeout?.();
        }
      }, timeoutMs);
    };

    const bump = () => {
      firedRef.current = false;
      localStorage.setItem(storageKey, String(Date.now()));
      resetTimer();
    };

    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));

    bump(); // start

    const onStorage = (e) => e.key === storageKey && resetTimer();
    window.addEventListener("storage", onStorage);

    const onVisibility = () => {
      if (document.hidden) return;
      const last = Number(localStorage.getItem(storageKey) || 0);
      const idleFor = Date.now() - last;
      if (idleFor >= timeoutMs && !firedRef.current) {
        firedRef.current = true;
        onTimeout?.();
      } else {
        resetTimer();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, timeoutMs, onTimeout, storageKey]);
}
