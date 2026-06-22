// app/login/page.tsx

"use client";

import { useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(email, password);
      const next = searchParams.get("next") || "/";
      router.push(next);
    } catch (err) {
      setError("Invalid email or password.");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: "80px auto", padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 24 }}>Sign in</h1>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc" }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc" }}
          />
        </label>

        {error && <p style={{ color: "#c00", fontSize: 14 }}>{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: "10px 16px",
            borderRadius: 6,
            border: "none",
            background: "#1a73e8",
            color: "white",
            fontWeight: 600,
            cursor: submitting ? "default" : "pointer",
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>

        <p style={{ textAlign: "center", fontSize: 13, color: "#555", marginTop: 4 }}>
          Don&apos;t have an account?{" "}
          <a href="/signup" style={{ color: "#1a73e8", fontWeight: 600 }}>
            Create Account
          </a>
        </p>
      </form>
    </div>
  );
}