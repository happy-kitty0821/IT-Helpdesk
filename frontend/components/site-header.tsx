"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { authPost, hasStaffRole, type AuthUser } from "@/lib/auth";
import { SuspensionBanner } from "./suspension-banner";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  const [user, setUser]     = useState<AuthUser | null>(null);
  const [open, setOpen]     = useState(false);
  const pathname            = usePathname();
  const drawerRef           = useRef<HTMLDivElement>(null);

  // Load current user
  useEffect(() => {
    fetch("/api/v1/auth/me/", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUser(data?.id ? (data as AuthUser) : null))
      .catch(() => setUser(null));
  }, []);

  // Close drawer when the route changes
  useEffect(() => { setOpen(false); }, [pathname]);

  // Close drawer when clicking outside of it
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  // Prevent body scroll while drawer is open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  async function signOut() {
    await authPost("logout", {});
    setUser(null);
    window.location.assign("/");
  }

  const isStaff = user ? hasStaffRole(user) : false;

  return (
    <>
      <header className="site-header">
        <div className="shell header-inner">
          {/* ── Logo / brand ── */}
          <Link href="/" className="brand" aria-label="IIC IT Helpdesk home">
            <Image
              src="/iic-logo.png"
              width={800}
              height={337}
              alt="Itahari International College, ING"
              priority
            />
            <span>
              <strong>IT &amp; NOC</strong>
              <small>Helpdesk</small>
            </span>
          </Link>

          {/* ── Desktop nav (hidden on mobile via CSS) ── */}
          <nav className="header-nav-desktop" aria-label="Primary navigation">
            <Link href="/#services">Services</Link>
            <Link href="/status">Status</Link>

            {user ? (
              <Link href="/profile" className="account-name"
                title={`${user.email} — view profile`}>
                {user.name}
              </Link>
            ) : (
              <Link href="/login">Sign in</Link>
            )}

            {user && (
              <Link href="/tickets" className="text-button">My tickets</Link>
            )}

            {isStaff && (
              <Link href="/admin" className="admin-link">
                {user?.is_superuser ? "Admin" : "Staff portal"}
              </Link>
            )}

            {user && (
              <button type="button" className="text-button" onClick={signOut}>
                Sign out
              </button>
            )}

            <Link href="/tickets/new" className="nav-action">
              Request support
            </Link>
            <ThemeToggle />
          </nav>

          {/* ── Mobile: hamburger + CTA button ── */}
          <div className="header-nav-mobile">
            {/* Always-visible CTA — most important action */}
            <Link href="/tickets/new" className="nav-action header-mobile-cta">
              Support
            </Link>
            <ThemeToggle />
            {/* Hamburger toggle */}
            <button
              type="button"
              className="hamburger-btn"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-controls="mobile-drawer"
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile drawer backdrop ── */}
      {open && (
        <div
          className="mobile-nav-backdrop"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      )}

      {/* ── Mobile drawer ── */}
      <div
        id="mobile-drawer"
        ref={drawerRef}
        className={`mobile-nav-drawer${open ? " mobile-nav-drawer--open" : ""}`}
        aria-label="Mobile navigation"
      >
        <nav>
          <Link href="/#services" className="mobile-nav-link">Services</Link>
          <Link href="/status"    className="mobile-nav-link">Service status</Link>
          <Link href="/help"      className="mobile-nav-link">Help guides</Link>
          <Link href="/software"  className="mobile-nav-link">Software</Link>

          <div className="mobile-nav-divider" />

          {user ? (
            <>
              <Link href="/profile"  className="mobile-nav-link">
                <span className="mobile-nav-user">
                  <span className="mobile-nav-user-avatar" aria-hidden="true">
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                  <span>
                    <strong>{user.name}</strong>
                    <small>{user.email}</small>
                  </span>
                </span>
              </Link>
              <Link href="/tickets"     className="mobile-nav-link">My tickets</Link>
              <Link href="/tickets/new" className="mobile-nav-link mobile-nav-link--cta">
                Request support
              </Link>
              {isStaff && (
                <Link href="/admin" className="mobile-nav-link">
                  {user?.is_superuser ? "Admin panel" : "Staff portal"}
                </Link>
              )}
              <div className="mobile-nav-divider" />
              <button
                type="button"
                className="mobile-nav-link mobile-nav-link--signout"
                onClick={signOut}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/tickets/new" className="mobile-nav-link mobile-nav-link--cta">
                Request support
              </Link>
              <Link href="/login"    className="mobile-nav-link">Sign in</Link>
              <Link href="/register" className="mobile-nav-link">Create account</Link>
            </>
          )}
        </nav>
      </div>

      {/* Suspension banner */}
      {user?.is_suspended && (
        <SuspensionBanner reason={user.suspension_reason || undefined} />
      )}
    </>
  );
}
