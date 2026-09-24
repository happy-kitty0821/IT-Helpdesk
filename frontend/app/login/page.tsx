"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { AlertTriangle } from "lucide-react";
import { FormEvent, useCallback, useState } from "react";
import { GoogleSignIn } from "@/components/google-sign-in";
import { SiteHeader } from "@/components/site-header";
import { authPost, SuspensionError } from "@/lib/auth";
import { staggerContainer, staggerItem, slideRight } from "@/lib/animations";

// ── Suspension notice card ────────────────────────────────────────────────────

function SuspensionNotice({ reason }: { reason: string }) {
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        background: "#fef2f2",
        border: "1.5px solid #fca5a5",
        borderRadius: 12,
        padding: "16px 18px",
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        marginBottom: 4,
      }}
    >
      <AlertTriangle
        aria-hidden="true"
        style={{ color: "#dc2626", flexShrink: 0, width: 20, height: 20, marginTop: 2 }}
      />
      <div>
        <strong style={{ display: "block", color: "#991b1b", fontSize: ".95rem", marginBottom: 6 }}>
          Account suspended
        </strong>
        {reason ? (
          <p style={{ margin: "0 0 6px", color: "#7f1d1d", fontSize: ".88rem", lineHeight: 1.55 }}>
            {reason}
          </p>
        ) : (
          <p style={{ margin: "0 0 6px", color: "#7f1d1d", fontSize: ".88rem", lineHeight: 1.55 }}>
            Your account has been suspended by an administrator.
          </p>
        )}
        <p style={{ margin: 0, color: "#991b1b", fontSize: ".83rem", lineHeight: 1.5 }}>
          Please visit the <strong>IIC IT &amp; NOC department in person</strong> during office
          hours to have your account reviewed and reinstated.
        </p>
      </div>
    </motion.div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const [error, setError]                     = useState("");
  const [suspensionReason, setSuspensionReason] = useState<string | null>(null);
  const [pending, setPending]                 = useState(false);
  const finish = useCallback(() => { window.location.assign("/"); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setSuspensionReason(null);
    const values = new FormData(event.currentTarget);
    try {
      await authPost("login", {
        identifier: values.get("identifier"),
        password:   values.get("password"),
      });
      finish();
    } catch (reason) {
      if (reason instanceof SuspensionError) {
        // Show the dedicated suspension notice instead of the generic error
        setSuspensionReason(reason.suspensionReason);
      } else {
        setError(reason instanceof Error ? reason.message : "Sign-in failed.");
      }
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
          <p className="eyebrow">IIC account</p>
          <h1>Sign in to the helpdesk</h1>
          <p>Use your username, college email, or approved IIC Google account.</p>

          {/* Suspension notice — replaces the normal form error */}
          {suspensionReason !== null && (
            <SuspensionNotice reason={suspensionReason} />
          )}

          <form onSubmit={submit} className="auth-form">
            <label>
              Username or college email
              <input name="identifier" autoComplete="username" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -4, marginBottom: 4 }}>
              <Link href="/forgot-password" style={{ fontSize: ".82rem", color: "var(--brand)", fontWeight: 700 }}>
                Forgot password?
              </Link>
            </div>
            <button className="primary-button" type="submit" disabled={pending}>
              {pending ? "Signing in…" : "Sign in"}
            </button>
            {error && <p className="auth-error" role="alert">{error}</p>}
          </form>
          <div className="auth-divider"><span>or</span></div>
          <GoogleSignIn onSuccess={finish} />
          <p className="auth-switch">
            New to the helpdesk? <Link href="/register">Create an IIC account</Link>
          </p>
        </motion.section>

        <motion.aside className="auth-aside" variants={slideRight}>
          <span className="panel-kicker">Domain protected</span>
          <h2>Only verified college accounts belong here.</h2>
          <p>
            Registration and Google sign-in are restricted to{" "}
            <strong>@iic.edu.np</strong> by the server.
          </p>
        </motion.aside>
      </motion.main>
    </>
  );
}
