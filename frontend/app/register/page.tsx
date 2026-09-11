"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { authPost } from "@/lib/auth";

export default function RegisterPage() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const values = new FormData(event.currentTarget);
    if (values.get("password") !== values.get("confirm_password")) {
      setError("Passwords do not match.");
      setPending(false);
      return;
    }
    try {
      await authPost("register", {
        username: values.get("username"), email: values.get("email"),
        first_name: values.get("first_name"), last_name: values.get("last_name"),
        password: values.get("password"),
      });
      window.location.assign("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Registration failed.");
      setPending(false);
    }
  }

  return (
    <><SiteHeader /><main className="auth-page shell"><section className="auth-card auth-card-wide"><p className="eyebrow">Create account</p><h1>Register with your IIC email</h1><p>Your email must end in <strong>@iic.edu.np</strong>. You will be signed in after registration.</p><form onSubmit={submit} className="auth-form two-column"><label>First name<input name="first_name" autoComplete="given-name" required /></label><label>Last name<input name="last_name" autoComplete="family-name" required /></label><label className="full-field">College email<input name="email" type="email" pattern=".+@iic\.edu\.np" title="Use your @iic.edu.np email" autoComplete="email" required /></label><label className="full-field">Username<input name="username" pattern="[A-Za-z0-9._-]{3,150}" title="Use letters, numbers, dots, underscores, or hyphens" autoComplete="username" required /></label><label>Password<input name="password" type="password" minLength={8} autoComplete="new-password" required /></label><label>Confirm password<input name="confirm_password" type="password" minLength={8} autoComplete="new-password" required /></label><button className="primary-button full-field" type="submit" disabled={pending}>{pending ? "Creating account…" : "Create account"}</button>{error && <p className="auth-error full-field" role="alert">{error}</p>}</form><p className="auth-switch">Already registered? <Link href="/login">Sign in</Link></p></section></main></>
  );
}
