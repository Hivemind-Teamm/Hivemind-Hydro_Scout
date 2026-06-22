"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function SignUpPage() {
  const { signup } = useAuth();
  const router = useRouter();

  const [displayName, setDisplayName] = useState("");
  const [email,       setEmail]       = useState("");
  const [password,    setPassword]    = useState("");
  const [confirm,     setConfirm]     = useState("");
  const [error,       setError]       = useState<string | null>(null);
  const [submitting,  setSubmitting]  = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setSubmitting(true);
    try {
      await signup(email, password, displayName.trim() || email.split("@")[0]);
      router.push("/");
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/email-already-in-use") {
        setError("An account with this email already exists.");
      } else if (code === "auth/invalid-email") {
        setError("Invalid email address.");
      } else {
        setError("Could not create account. Please try again.");
      }
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: "80px auto", padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Create Account</h1>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 24 }}>
        New accounts start as <strong>General User</strong>. Contact your station admin to upgrade your role.
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Display Name
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="name"
            placeholder="e.g. Juan dela Cruz"
            style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc" }}
          />
        </label>

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
            autoComplete="new-password"
            placeholder="At least 6 characters"
            style={{ padding: 8, borderRadius: 6, border: "1px solid #ccc" }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Confirm Password
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
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
          {submitting ? "Creating account…" : "Create Account"}
        </button>

        <p style={{ textAlign: "center", fontSize: 13, color: "#555", marginTop: 4 }}>
          Already have an account?{" "}
          <a href="/login" style={{ color: "#1a73e8", fontWeight: 600 }}>
            Sign in
          </a>
        </p>
      </form>
    </div>
  );
}
