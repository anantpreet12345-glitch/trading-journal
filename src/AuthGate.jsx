import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import AuthForm from "./AuthForm"; // make sure this file exists

/**
 * AuthGate
 * - Loads the current Supabase user
 * - Listens for auth state changes (login / logout)
 * - If not logged in, shows <AuthForm />
 * - If logged in, renders children (function-as-children supported)
 * - Auto-logout after 30 minutes of inactivity (cross-tab)
 */
export default function AuthGate({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    // 1) Get the currently logged-in user (if any)
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!mounted) return;
      if (error) console.error("getUser error:", error);
      setUser(data?.user ?? null);
      setReady(true);
    })();

    // 2) Subscribe to login/logout events
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      // Unsubscribe on unmount (v2: listener.subscription.unsubscribe())
      listener?.subscription?.unsubscribe?.();
    };
  }, []);

  // ---- AUTO LOGOUT (30 minutes inactivity, synced across tabs) ----
  useEffect(() => {
    if (!user) return; // only track when signed in

    const IDLE_MS = 30 * 60 * 1000; // 30 minutes
    let timerId = null;
    let lastActivity = Date.now();

    // cross-tab channel (best effort)
    let bc = null;
    try {
      bc = new BroadcastChannel("auth-events");
    } catch (_) {
      // some browsers / environments may not support BroadcastChannel
    }

    const forceLogoutEverywhere = async () => {
      try {
        // optional: clear any local cache your app uses
        try { localStorage.removeItem("trading_journal_v2"); } catch (_) {}
        await supabase.auth.signOut();
      } catch (e) {
        console.error("Auto-logout signOut failed:", e);
      } finally {
        // notify other tabs
        try { bc?.postMessage("force-logout"); } catch (_) {}
        // localStorage fallback sync
        try { localStorage.setItem("__force_logout__", String(Date.now())); } catch (_) {}
      }
    };

    const resetTimer = () => {
      lastActivity = Date.now();
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(checkIdle, IDLE_MS + 1000);
    };

    const checkIdle = () => {
      if (Date.now() - lastActivity >= IDLE_MS) {
        forceLogoutEverywhere();
      } else {
        resetTimer();
      }
    };

    const onActivity = () => resetTimer();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && Date.now() - lastActivity >= IDLE_MS) {
        forceLogoutEverywhere();
      } else {
        resetTimer();
      }
    };

    // User activity listeners
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Cross-tab listeners
    const onBcMessage = (e) => { if (e?.data === "force-logout") forceLogoutEverywhere(); };
    try { if (bc) bc.onmessage = onBcMessage; } catch (_) {}
    const onStorage = (e) => { if (e.key === "__force_logout__") forceLogoutEverywhere(); };
    window.addEventListener("storage", onStorage);

    // start timer
    resetTimer();

    return () => {
      if (timerId) clearTimeout(timerId);
      events.forEach((ev) => window.removeEventListener(ev, onActivity));
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("storage", onStorage);
      try { bc && bc.close(); } catch (_) {}
    };
  }, [user]);

  // While checking session, render nothing (or a tiny spinner if you prefer)
  if (!ready) return null;

  // Not authenticated → show the sign-in / sign-up form
  if (!user) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f172a",
        }}
      >
        <div
          style={{
            background: "#ffffff",
            padding: 24,
            borderRadius: 16,
            boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
            width: "100%",
            maxWidth: 420,
          }}
        >
          <AuthForm />
        </div>
      </div>
    );
  }

  // Authenticated → render the app, passing the user
  return typeof children === "function" ? children(user) : children;
}
