// src/AuthForm.jsx
import React, { useState } from "react";
import { supabase } from "./supabaseClient";

// Use your deployed URL for email links in production.
// Set REACT_APP_SITE_URL in Vercel (and .env.local for dev).
const SITE_URL = process.env.REACT_APP_SITE_URL || window.location.origin;

export default function AuthForm() {
  const [mode, setMode] = useState("signin"); // 'signin' | 'signup'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      if (mode === "signup") {
        // IMPORTANT: make Supabase’s confirmation link open on your deployed site
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: SITE_URL },
        });
        if (error) throw error;
        setMsg("Account created. Check your email to confirm, then sign in.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setMsg(err.message || "Auth error");
    } finally {
      setBusy(false);
    }
  }

  // Minimal, non-disruptive reset password action
  async function handleResetPassword(e) {
    e.preventDefault();
    if (!email) {
      setMsg("Enter your email above, then click “Forgot password?”");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      // Make Supabase’s reset link open on your deployed site
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: SITE_URL,
      });
      if (error) throw error;
      setMsg("Password reset email sent. Check your inbox.");
    } catch (err) {
      setMsg(err.message || "Could not send reset email");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 360, width: "100%", padding: 16 }}>
      <h2 style={{ marginBottom: 12, textAlign: "center" }}>
        {mode === "signin" ? "Sign in" : "Create account"}
      </h2>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 10 }}>
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: 10, borderRadius: 8, border: "1px solid #e5e7eb" }}
        />
        <input
          type="password"
          required
          placeholder="Password (min 6 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ padding: 10, borderRadius: 8, border: "1px solid #e5e7eb" }}
        />

        {/* Forgot password (only shown on sign-in) */}
        {mode === "signin" && (
          <div style={{ textAlign: "right", marginTop: -4 }}>
            <button
              type="button"
              onClick={handleResetPassword}
              disabled={busy}
              style={{
                background: "transparent",
                border: "none",
                color: "#2563eb",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Forgot password?
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            background: "#111827",
            color: "white",
            cursor: "pointer",
          }}
        >
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Sign up"}
        </button>
      </form>

      {msg && <div style={{ marginTop: 10, fontSize: 13, color: "#ef4444" }}>{msg}</div>}

      <div style={{ marginTop: 14, fontSize: 13, textAlign: "center" }}>
        {mode === "signin" ? (
          <>
            No account?{" "}
            <button
              onClick={() => setMode("signup")}
              style={{ background: "transparent", border: "none", color: "#2563eb", cursor: "pointer" }}
            >
              Sign up
            </button>
          </>
        ) : (
          <>
            Have an account?{" "}
            <button
              onClick={() => setMode("signin")}
              style={{ background: "transparent", border: "none", color: "#2563eb", cursor: "pointer" }}
            >
              Sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}

