import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import AuthForm from "./AuthForm"; // make sure this file exists

/**
 * AuthGate
 * - Loads the current Supabase user
 * - Listens for auth state changes (login / logout)
 * - If not logged in, shows <AuthForm />
 * - If logged in, renders children (function-as-children supported)
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