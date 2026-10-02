"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { CheckCircle2, Loader2, MailCheck, ShieldAlert } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { csrfToken } from "@/lib/auth";
import { scalePop, staggerContainer, fadeUp } from "@/lib/animations";

// ── Inner component (needs Suspense because it uses useSearchParams) ──────────

function VerifyEmailContent() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const token        = searchParams.get("token") ?? "";

  type State = "loading" | "success" | "error" | "missing";
  const [state,   setState]   = useState<State>(token ? "loading" : "missing");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) { setState("missing"); return; }

    let cancelled = false;

    async function verify() {
      try {
        const csrf = await csrfToken();
        const res  = await fetch("/api/v1/auth/verify-email/", {
          method:  "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "X-CSRFToken": csrf },
          body:    JSON.stringify({ token }),
        });
        if (cancelled) return;

        const data = await res.json().catch(() => ({})) as { detail?: string };

        if (res.ok) {
          setState("success");
          // Redirect to home after 3 s so the user can read the success message
          setTimeout(() => { if (!cancelled) router.replace("/"); }, 3000);
        } else {
          setState("error");
          setMessage(data.detail ?? "Verification failed. The link may have expired.");
        }
      } catch {
        if (!cancelled) {
          setState("error");
          setMessage("A network error occurred. Please try again.");
        }
      }
    }

    verify();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (state === "loading") {
    return (
      <motion.div variants={staggerContainer} initial="hidden" animate="show"
        style={{ textAlign: "center", padding: "8px 0 4px" }}>
        <motion.div variants={scalePop} style={{ display: "inline-flex", marginBottom: 24 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 20,
            background: "linear-gradient(145deg,#eef2ff,#e0e7ff)",
            display: "grid", placeItems: "center",
          }}>
            <Loader2 size={34} className="spin" style={{ color: "var(--brand)" }} aria-hidden="true" />
          </div>
        </motion.div>
        <motion.div variants={fadeUp}>
          <h1 style={{ fontSize: "clamp(1.8rem,4vw,2.6rem)", letterSpacing: "-.04em", marginBottom: 10 }}>
            Verifying your email…
          </h1>
          <p style={{ color: "var(--muted)", maxWidth: 360, marginInline: "auto" }}>
            Please wait while we confirm your email address.
          </p>
        </motion.div>
      </motion.div>
    );
  }

  // ── Success ───────────────────────────────────────────────────────────────
  if (state === "success") {
    return (
      <motion.div variants={staggerContainer} initial="hidden" animate="show"
        style={{ textAlign: "center", padding: "8px 0 4px" }}>
        <motion.div variants={scalePop} style={{ display: "inline-flex", marginBottom: 24 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 20,
            background: "#f0fdf4", display: "grid", placeItems: "center",
          }}>
            <CheckCircle2 size={38} style={{ color: "#16a34a" }} aria-hidden="true" />
          </div>
        </motion.div>
        <motion.div variants={fadeUp}>
          <p className="eyebrow" style={{ color: "#16a34a" }}>All done</p>
          <h1 style={{ fontSize: "clamp(1.8rem,4vw,2.6rem)", letterSpacing: "-.04em", marginBottom: 12 }}>
            Email verified
          </h1>
          <p style={{ color: "var(--muted)", marginBottom: 28, maxWidth: 380, marginInline: "auto", lineHeight: 1.6 }}>
            Your IIC IT Helpdesk account is now active. You&apos;ll be redirected to the
            home page in a moment.
          </p>
          <Link href="/" className="primary-button"
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <MailCheck size={16} aria-hidden="true" /> Go to helpdesk
          </Link>
        </motion.div>
      </motion.div>
    );
  }

  // ── Missing token ─────────────────────────────────────────────────────────
  if (state === "missing") {
    return (
      <motion.div variants={staggerContainer} initial="hidden" animate="show"
        style={{ textAlign: "center", padding: "8px 0 4px" }}>
        <motion.div variants={scalePop} style={{ display: "inline-flex", marginBottom: 24 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 20,
            background: "#fef2f2", display: "grid", placeItems: "center",
          }}>
            <ShieldAlert size={34} style={{ color: "#dc2626" }} aria-hidden="true" />
          </div>
        </motion.div>
        <motion.div variants={fadeUp}>
          <h1 style={{ fontSize: "clamp(1.8rem,4vw,2.6rem)", letterSpacing: "-.04em", marginBottom: 12 }}>
            Missing verification link
          </h1>
          <p style={{ color: "var(--muted)", marginBottom: 28, maxWidth: 380, marginInline: "auto" }}>
            No verification token was found. Please click the link in your email directly.
            If you need a new link, sign in and visit your profile.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
            <Link href="/login" className="primary-button"
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              Sign in
            </Link>
            <Link href="/" style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "11px 18px", border: "1px solid var(--border)",
              borderRadius: 10, fontWeight: 750, fontSize: ".9rem",
              color: "var(--foreground)", textDecoration: "none",
            }}>
              Back to home
            </Link>
          </div>
        </motion.div>
      </motion.div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show"
      style={{ textAlign: "center", padding: "8px 0 4px" }}>
      <motion.div variants={scalePop} style={{ display: "inline-flex", marginBottom: 24 }}>
        <div style={{
          width: 72, height: 72, borderRadius: 20,
          background: "#fef2f2", display: "grid", placeItems: "center",
        }}>
          <ShieldAlert size={34} style={{ color: "#dc2626" }} aria-hidden="true" />
        </div>
      </motion.div>
      <motion.div variants={fadeUp}>
        <h1 style={{ fontSize: "clamp(1.8rem,4vw,2.6rem)", letterSpacing: "-.04em", marginBottom: 12 }}>
          Verification failed
        </h1>
        <p style={{ color: "var(--muted)", marginBottom: 8, maxWidth: 420, marginInline: "auto", lineHeight: 1.6 }}>
          {message}
        </p>
        <p style={{ color: "var(--muted)", marginBottom: 28, fontSize: ".88rem", maxWidth: 380, marginInline: "auto" }}>
          Verification links expire after 24 hours and can only be used once.
          Sign in to your account and request a new verification email from your profile page.
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
          <Link href="/login" className="primary-button"
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            Sign in
          </Link>
          <Link href="/profile" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "11px 18px", border: "1px solid var(--border)",
            borderRadius: 10, fontWeight: 750, fontSize: ".9rem",
            color: "var(--foreground)", textDecoration: "none",
          }}>
            Go to profile
          </Link>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Page shell ────────────────────────────────────────────────────────────────

export default function VerifyEmailPage() {
  return (
    <>
      <SiteHeader />
      <main className="auth-page shell" style={{ alignItems: "start", paddingTop: 72 }}>
        <section className="auth-card" style={{ maxWidth: 520, width: "100%" }}>
          <Suspense fallback={
            <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
              <Loader2 size={28} className="spin" style={{ color: "var(--brand)" }} aria-label="Loading" />
            </div>
          }>
            <VerifyEmailContent />
          </Suspense>
        </section>

        <aside className="auth-aside" style={{ position: "sticky", top: 110 }}>
          <span className="panel-kicker">Email verification</span>
          <h2>Confirming your IIC account</h2>
          <p>
            Verifying your email address proves you own the account and unlocks
            full helpdesk access.
          </p>
          <div style={{
            marginTop: 24, paddingTop: 20,
            borderTop: "1px solid rgba(255,255,255,.22)",
            display: "flex", gap: 10, alignItems: "flex-start",
            color: "#e7edff", fontSize: ".88rem",
          }}>
            <MailCheck size={18} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
            <span>
              Links expire after 24 hours. If yours has expired, sign in and
              request a new one from your profile page.
            </span>
          </div>
        </aside>
      </main>
    </>
  );
}
