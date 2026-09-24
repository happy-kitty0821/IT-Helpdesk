"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { CheckCircle2, Eye, EyeOff } from "lucide-react";
import { FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { csrfToken } from "@/lib/auth";
import { staggerContainer, staggerItem } from "@/lib/animations";

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

  if (!token) {
    return (
      <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
        <h1>Invalid link</h1>
        <p style={{ color: "var(--muted)", marginBottom: 24 }}>
          This password reset link is invalid or missing. Please request a new one.
        </p>
        <Link href="/forgot-password" className="primary-button">
          Request a new link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
        <CheckCircle2
          aria-hidden="true"
          style={{ width: 48, height: 48, color: "#166534", margin: "0 auto 16px", display: "block" }}
        />
        <h1 style={{ marginBottom: 10 }}>Password reset</h1>
        <p style={{ color: "var(--muted)", marginBottom: 28 }}>
          Your password has been updated successfully. You can now sign in with your new password.
        </p>
        <Link href="/login" className="primary-button">Sign in</Link>
      </div>
    );
  }

  return (
    <>
      <p className="eyebrow">Account recovery</p>
      <h1>Set a new password</h1>
      <p>Choose a strong password for your IIC IT Helpdesk account.</p>

      <form onSubmit={submit} className="auth-form">
        {/* Password */}
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
              style={{ paddingRight: 40 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              style={{
                position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                border: 0, background: "transparent", cursor: "pointer", color: "var(--muted)",
                display: "flex", padding: 4,
              }}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {fieldErrors.password && (
            <span className="field-error" role="alert">{fieldErrors.password}</span>
          )}
        </label>

        {/* Confirm */}
        <label>
          Confirm new password
          <input
            type={showPassword ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={8}
            autoComplete="new-password"
            required
          />
          {fieldErrors.confirm_password && (
            <span className="field-error" role="alert">{fieldErrors.confirm_password}</span>
          )}
        </label>

        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Set new password"}
        </button>
        {error && <p className="auth-error" role="alert">{error}</p>}
      </form>

      <p className="auth-switch">
        <Link href="/forgot-password">Request a new link</Link>
      </p>
    </>
  );
}

export default function ResetPasswordPage() {
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
          <Suspense fallback={<p style={{ color: "var(--muted)" }}>Loading…</p>}>
            <ResetPasswordForm />
          </Suspense>
        </motion.section>
      </motion.main>
    </>
  );
}
