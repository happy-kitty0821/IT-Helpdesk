"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { authPost, type AuthUser } from "@/lib/auth";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    fetch("/api/v1/auth/me/", { credentials: "include" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setUser(data?.id ? data as AuthUser : null))
      .catch(() => setUser(null));
  }, []);

  async function signOut() {
    await authPost("logout", {});
    setUser(null);
    window.location.assign("/");
  }

  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link href="/" className="brand" aria-label="IIC IT Helpdesk home">
          <Image src="/iic-logo.png" width={800} height={337} alt="Itahari International College, ING" priority />
          <span><strong>IT & NOC</strong><small>Helpdesk</small></span>
        </Link>
        <nav aria-label="Primary navigation">
          <Link href="#services">Services</Link>
          <Link href="#status">Status</Link>
          {user ? <span className="account-name" title={user.email}>{user.name}</span> : <Link href="/login">Sign in</Link>}
          {user?.is_superuser && <Link href="/admin" className="admin-link">Admin</Link>}
          {user && <button type="button" className="text-button" onClick={signOut}>Sign out</button>}
          <Link href="/tickets/new" className="nav-action">Request support</Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
