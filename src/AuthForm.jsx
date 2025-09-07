// src/AuthForm.jsx
import React, { useState } from "react";
import { supabase } from "./supabaseClient";

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
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg("Account created. You can sign in now.");
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

