"use client";

import Link from "next/link";
import { FormEvent, useCallback, useState } from "react";
import { GoogleSignIn } from "@/components/google-sign-in";
import { SiteHeader } from "@/components/site-header";
import { authPost } from "@/lib/auth";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const finish = useCallback(() => { window.location.assign("/"); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const values = new FormData(event.currentTarget);
    try {
      await authPost("login", { identifier: values.get("identifier"), password: values.get("password") });
      finish();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed.");
      setPending(false);
    }
  }

  return (
    <><SiteHeader /><main className="auth-page shell"><section className="auth-card"><p className="eyebrow">IIC account</p><h1>Sign in to the helpdesk</h1><p>Use your username, college email, or approved IIC Google account.</p><form onSubmit={submit} className="auth-form"><label>Username or college email<input name="identifier" autoComplete="username" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" required /></label><button className="primary-button" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>{error && <p className="auth-error" role="alert">{error}</p>}</form><div className="auth-divider"><span>or</span></div><GoogleSignIn onSuccess={finish} /><p className="auth-switch">New to the helpdesk? <Link href="/register">Create an IIC account</Link></p></section><aside className="auth-aside"><span className="panel-kicker">Domain protected</span><h2>Only verified college accounts belong here.</h2><p>Registration and Google sign-in are restricted to <strong>@iic.edu.np</strong> by the server.</p></aside></main></>
  );
}
