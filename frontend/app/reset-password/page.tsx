"use client";

import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, ShieldAlert } from "lucide-react";
import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { csrfToken } from "@/lib/auth";
import { staggerContainer, staggerItem, scalePop, fadeUp } from "@/lib/animations";

// ── Password strength meter ───────────────────────────────────────────────────

function strengthOf(pw: string): { level: number; label: string; color: string } {
  if (!pw) return { level: 0, label: "", color: "#e2e8f0" };
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { level: 1, label: "Weak",   color: "#ef4444" };
  if (score <= 2) return { level: 2, label: "Fair",   color: "#f97316" };
  if (score <= 3) return { level: 3, label: "Good",   color: "#eab308" };
  if (score <= 4) return { level: 4, label: "Strong", color: "#22c55e" };
  return              { level: 5, label: "Very strong", color: "#16a34a" };
}

function StrengthBar({ password }: { password: string }) {
  const { level, label, color } = strengthOf(password);
  if (!password) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <motion.div
            key={i}
            style={{ height: 3, flex: 1, borderRadius: 99, background: i <= level ? color : "#e2e8f0" }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.2, delay: i * 0.04 }}
          />
        ))}
      </div>
      <p style={{ margin: 0, fontSize: ".72rem", color, fontWeight: 700 }}>{label}</p>
    </div>
  );
}

// ── Invalid / missing token state ─────────────────────────────────────────────

function InvalidLink() {
  return (
    <motion.div
      variants={staggerContainer} initial="hidden" animate="show"
      style={{ textAlign: "center", padding: "8px 0 4px" }}
    >
      <motion.div variants={scalePop} style={{ display: "inline-flex", marginBottom: 20 }}>
        <div style={{
          width: 72, height: 72, borderRadius: 20,
          background: "#fef2f2", display: "grid", placeItems: "center",
        }}>
          <ShieldAlert size={34} style={{ color: "#dc2626" }} aria-hidden="true" />
        </div>
      </motion.div>
      <motion.div variants={fadeUp}>
        <h1 style={{ fontSize: "clamp(1.8rem,4vw,2.6rem)", letterSpacing: "-.04em", marginBottom: 10 }}>
          Invalid link
        </h1>
        <p style={{ color: "var(--muted)", marginBottom: 28, maxWidth: 360, marginInline: "auto" }}>
          This password reset link is invalid or has expired. Request a new one and check
          your inbox within 30 minutes.
        </p>
        <Link href="/forgot-password" className="primary-button">
          Request a new link
        </Link>
      </motion.div>
    </motion.div>
  );
}

// ── Success state ─────────────────────────────────────────────────────────────

function SuccessState() {
  return (
    <motion.div
      variants={staggerContainer} initial="hidden" animate="show"
      style={{ textAlign: "center", padding: "8px 0 4px" }}
    >
      <motion.div variants={scalePop} style={{ display: "inline-flex", marginBottom: 20 }}>
        <div style={{
          width: 72, height: 72, borderRadius: 20,
          background: "#f0fdf4", display: "grid", placeItems: "center",
        }}>
          <CheckCircle2 size={38} style={{ color: "#16a34a" }} aria-hidden="true" />
        </div>
      </motion.div>
      <motion.div variants={fadeUp}>
        <h1 style={{ fontSize: "clamp(1.8rem,4vw,2.6rem)", letterSpacing: "-.04em", marginBottom: 10 }}>
          Password updated
        </h1>
        <p style={{ color: "var(--muted)", marginBottom: 28, maxWidth: 360, marginInline: "auto" }}>
          Your password has been set successfully. Sign in to the helpdesk with your new credentials.
        </p>
        <Link href="/login" className="primary-button" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <KeyRound size={15} aria-hidden="true" /> Go to sign in
        </Link>
      </motion.div>
    </motion.div>
  );
}

// ── Form ──────────────────────────────────────────────────────────────────────

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token        = searchParams.get("token") ?? "";

  const [password,        setPassword]        = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword,    setShowPassword]    = useState(false);
  const [pending,         setPending]         = useState(false);
  const [done,            setDone]            = useState(false);
  const [error,           setError]           = useState("");
  const [fieldErrors,     setFieldErrors]     = useState<Record<string, string>>({});

  if (!token) return <InvalidLink />;
  if (done)   return <SuccessState />;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFieldErrors({});
    setError("");
    if (password !== confirmPassword) {
      setFieldErrors({ confirm_password: "Passwords do not match." });
      return;
    }
    setPending(true);
    try {
      const csrf = await csrfToken();
      const res  = await fetch("/api/v1/auth/reset-password/", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": csrf },
        body: JSON.stringify({ token, password, confirm_password: confirmPassword }),
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        if (Array.isArray(data.password)) {
          setFieldErrors({ password: (data.password as string[])[0] });
        } else {
          setError(typeof data.detail === "string" ? data.detail : "Reset failed. Please try again.");
        }
      } else {
        setDone(true);
      }
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const toggleEye = (
    <button
      type="button"
      onClick={() => setShowPassword((v) => !v)}
      aria-label={showPassword ? "Hide password" : "Show password"}
      style={{
        position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
        border: 0, background: "transparent", cursor: "pointer",
        color: "var(--muted)", display: "flex", padding: 4,
      }}
    >
      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
    </button>
  );

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show">

      {/* Icon badge */}
      <motion.div variants={scalePop} style={{ marginBottom: 22 }}>
        <div style={{
          width: 60, height: 60, borderRadius: 18,
          background: "linear-gradient(145deg,#eef2ff,#e0e7ff)",
          display: "grid", placeItems: "center",
        }}>
          <KeyRound size={28} style={{ color: "var(--brand)" }} aria-hidden="true" />
        </div>
      </motion.div>

      {/* Heading */}
      <motion.div variants={fadeUp}>
        <p className="eyebrow">Account recovery</p>
        <h1 style={{ fontSize: "clamp(1.9rem,4vw,2.8rem)", letterSpacing: "-.04em", marginBottom: 10 }}>
          Set a new password
        </h1>
        <p style={{ color: "var(--muted)", marginBottom: 4, maxWidth: 400 }}>
          Choose a strong password to secure your IIC IT Helpdesk account.
        </p>
      </motion.div>

      {/* Error banner */}
      <AnimatePresence>
        {error && (
          <motion.p
            key="err"
            role="alert"
            className="auth-error"
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            style={{ marginTop: 18, marginBottom: 0, overflow: "hidden" }}
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Form */}
      <motion.form variants={fadeUp} onSubmit={submit} className="auth-form" style={{ marginTop: 26 }}>

        {/* New password */}
        <label>
          New password
          <div style={{ position: "relative" }}>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              autoComplete="new-password"
              required
              aria-describedby="pw-strength"
              style={{
                paddingRight: 44,
                borderColor: fieldErrors.password ? "#f87171" : undefined,
                transition: "border-color 140ms",
              }}
            />
            {toggleEye}
          </div>
          <div id="pw-strength"><StrengthBar password={password} /></div>
          <AnimatePresence>
            {fieldErrors.password && (
              <motion.span
                className="field-error" role="alert"
                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              >
                {fieldErrors.password}
              </motion.span>
            )}
          </AnimatePresence>
        </label>

        {/* Confirm password */}
        <label>
          Confirm new password
          <div style={{ position: "relative" }}>
            <input
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              autoComplete="new-password"
              required
              style={{
                paddingRight: 44,
                borderColor: fieldErrors.confirm_password ? "#f87171" : undefined,
                transition: "border-color 140ms",
              }}
            />
            {toggleEye}
          </div>
          <AnimatePresence>
            {fieldErrors.confirm_password && (
              <motion.span
                className="field-error" role="alert"
                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              >
                {fieldErrors.confirm_password}
              </motion.span>
            )}
          </AnimatePresence>
        </label>

        {/* Hint */}
        <p style={{
          margin: "-6px 0 0", fontSize: ".78rem", color: "var(--muted)",
          background: "var(--brand-soft)", borderRadius: 8, padding: "8px 11px", lineHeight: 1.55,
        }}>
          Use at least 8 characters. Mix uppercase, numbers, and symbols for a stronger password.
        </p>

        {/* Submit */}
        <motion.button
          className="primary-button"
          type="submit"
          disabled={pending}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", minHeight: 48 }}
          whileHover={{ scale: pending ? 1 : 1.01 }}
          whileTap={{ scale: pending ? 1 : 0.98 }}
        >
          {pending
            ? <><Loader2 size={16} className="spin" aria-hidden="true" /> Setting password…</>
            : <><KeyRound size={16} aria-hidden="true" /> Set new password</>}
        </motion.button>
      </motion.form>

      <p className="auth-switch" style={{ textAlign: "center", marginTop: 24 }}>
        Link not working?{" "}
        <Link href="/forgot-password" style={{ color: "var(--brand)", fontWeight: 800 }}>
          Request a new one
        </Link>
      </p>
    </motion.div>
  );
}

// ── Page shell ────────────────────────────────────────────────────────────────

export default function ResetPasswordPage() {
  return (
    <>
      <SiteHeader />
      <motion.main
        className="auth-page shell"
        style={{ alignItems: "start", paddingTop: 72 }}
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        {/* Card — narrower for a focused password-reset experience */}
        <motion.section
          className="auth-card"
          variants={staggerItem}
          style={{ maxWidth: 500, width: "100%" }}
        >
          <Suspense fallback={
            <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
              <Loader2 size={28} className="spin" style={{ color: "var(--brand)" }} aria-label="Loading" />
            </div>
          }>
            <ResetPasswordForm />
          </Suspense>
        </motion.section>

        {/* Aside panel */}
        <motion.aside
          className="auth-aside"
          variants={staggerItem}
          style={{ position: "sticky", top: 110 }}
        >
          <span className="panel-kicker">Secure reset</span>
          <h2>One-time link, valid for 30 minutes.</h2>
          <p>
            Your link is single-use and expires after half an hour. After setting
            your password you can sign in immediately.
          </p>
          <div style={{
            marginTop: 24, paddingTop: 20,
            borderTop: "1px solid rgba(255,255,255,.22)",
            display: "flex", gap: 10, alignItems: "flex-start",
            color: "#e7edff", fontSize: ".88rem",
          }}>
            <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
            <span>Never share your reset link. IIC IT staff will never ask for it.</span>
          </div>
        </motion.aside>
      </motion.main>
    </>
  );
}
