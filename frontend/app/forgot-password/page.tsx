"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { CheckCircle2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { csrfToken } from "@/lib/auth";
import { staggerContainer, staggerItem } from "@/lib/animations";

export default function ForgotPasswordPage() {
  const [email, setEmail]     = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const token = await csrfToken();
      const res   = await fetch("/api/v1/auth/forgot-password/", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": token },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { detail?: string };
        setError(d.detail ?? "Something went wrong. Please try again.");
      } else {
        setSent(true);
      }
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <motion.main
        className="auth-page shell"
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        <motion.section className="auth-card" variants={staggerItem}>
          {sent ? (
            <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
              <CheckCircle2
                aria-hidden="true"
                style={{ width: 48, height: 48, color: "#166534", margin: "0 auto 16px", display: "block" }}
              />
              <h1 style={{ marginBottom: 10 }}>Check your inbox</h1>
              <p style={{ color: "var(--muted)", marginBottom: 24 }}>
                If <strong>{email}</strong> belongs to an active account, a password-reset
                link has been sent. Check your spam folder if you don&apos;t see it.
              </p>
              <p style={{ fontSize: ".88rem", color: "var(--muted)" }}>
                The link expires in 2 hours.
              </p>
              <p className="auth-switch" style={{ marginTop: 24 }}>
                <Link href="/login">Back to sign in</Link>
              </p>
            </div>
          ) : (
            <>
              <p className="eyebrow">Account recovery</p>
              <h1>Forgot your password?</h1>
              <p>
                Enter your college email address and we&apos;ll send you a reset link if an
                active account exists.
              </p>

              <form onSubmit={submit} className="auth-form">
                <label>
                  College email address
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@iic.edu.np"
                    autoComplete="email"
                    required
                  />
                </label>
                <button className="primary-button" type="submit" disabled={pending}>
                  {pending ? "Sending…" : "Send reset link"}
                </button>
                {error && <p className="auth-error" role="alert">{error}</p>}
              </form>

              <p className="auth-switch">
                Remembered it? <Link href="/login">Sign in</Link>
              </p>
            </>
          )}
        </motion.section>

        <motion.aside className="auth-aside" variants={staggerItem}>
          <span className="panel-kicker">Secure reset</span>
          <h2>We&apos;ll only send a link to verified college emails.</h2>
          <p>
            The reset link is valid for <strong>2 hours</strong> and can only be used
            once. Contact the IT helpdesk if you need further assistance.
          </p>
        </motion.aside>
      </motion.main>
    </>
  );
}
