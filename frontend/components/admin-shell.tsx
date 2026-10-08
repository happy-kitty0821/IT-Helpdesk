"use client";

import {
  Activity, Bell, BookOpen, Boxes, CircleDot, Gauge,
  Home, LayoutGrid, LoaderCircle, Megaphone, Menu,
  MessageSquareDashed, Settings, Shield, ShieldAlert, Siren, Users, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  hasStaffRole, highestRole, ROLE_LABELS,
  type AuthUser, type RoleValue,
} from "@/lib/auth";
import { UploadQueueProvider } from "@/lib/upload-queue";
import { UploadQueueWidget } from "@/components/upload-queue-widget";

// ── Nav item definition ───────────────────────────────────────────────────────

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  /** Roles that may visit this page. Undefined = all staff. */
  allowedRoles?: RoleValue[];
}

const ALL_NAV: NavItem[] = [
  { href: "/admin",               label: "Overview",      icon: Gauge },
  { href: "/admin/tickets",       label: "Tickets",       icon: CircleDot },
  { href: "/admin/notifications", label: "Notifications", icon: Bell,
    allowedRoles: ["administrator", "service_lead"] },
  { href: "/admin/services",      label: "Services",      icon: LayoutGrid,
    allowedRoles: ["administrator", "service_lead", "content_editor"] },
  { href: "/admin/guides",        label: "Guides",        icon: BookOpen,
    allowedRoles: ["administrator", "service_lead", "content_editor"] },
  { href: "/admin/software",      label: "Software",      icon: Boxes,
    allowedRoles: ["administrator", "service_lead", "content_editor"] },
  { href: "/admin/users",         label: "Users",         icon: Users,
    allowedRoles: ["administrator"] },
  { href: "/admin/announcements", label: "Announcements", icon: Megaphone,
    allowedRoles: ["administrator"] },
  { href: "/admin/status",        label: "Service Status",  icon: Activity,
    allowedRoles: ["administrator", "service_lead"] },
  { href: "/admin/feedback",      label: "Feedback",        icon: MessageSquareDashed,
    allowedRoles: ["administrator", "service_lead"] },
  { href: "/admin/rate-limits",    label: "Rate Limits",    icon: Siren,
    allowedRoles: ["administrator"] },
  { href: "/admin/roles",         label: "Roles",         icon: Shield,
    allowedRoles: ["administrator"] },
  { href: "/admin/settings",      label: "Settings",      icon: Settings,
    allowedRoles: ["administrator"] },
];

/** Nav items visible to the given user. */
function visibleNav(user: AuthUser): NavItem[] {
  if (user.is_superuser) return ALL_NAV;
  return ALL_NAV.filter(({ allowedRoles }) =>
    !allowedRoles?.length || user.roles.some((r) => allowedRoles.includes(r))
  );
}

/** True if the user may visit the given pathname. */
function canVisit(user: AuthUser, path: string): boolean {
  if (user.is_superuser) return true;
  // Find the most-specific nav item that covers this path (longest prefix first)
  const sorted = [...ALL_NAV].sort((a, b) => b.href.length - a.href.length);
  const match = sorted.find((n) => path === n.href || path.startsWith(n.href + "/"));
  if (!match) return true; // no rule → open
  if (!match.allowedRoles?.length) return true; // open to all staff
  return user.roles.some((r) => match.allowedRoles!.includes(r));
}

/** First page the user is allowed to visit. */
function fallbackPage(user: AuthUser): string {
  return visibleNav(user)[0]?.href ?? "/";
}

// ── Role badge colours ────────────────────────────────────────────────────────

const ROLE_BADGE: Record<string, { text: string; bg: string }> = {
  administrator:       { text: "#991b1b", bg: "#fee2e2" },
  service_lead:        { text: "#92400e", bg: "#fef3c7" },
  it_agent:            { text: "#1e40af", bg: "#dbeafe" },
  it_noc_intern:       { text: "#5b21b6", bg: "#ede9fe" },
  designated_approver: { text: "#065f46", bg: "#d1fae5" },
  content_editor:      { text: "#9a3412", bg: "#ffedd5" },
};

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const [state, setState] = useState<{ loading: boolean; user: AuthUser | null }>({
    loading: true,
    user: null,
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Fetch current user once on mount
  useEffect(() => {
    fetch("/api/v1/auth/me/", { credentials: "include", cache: "no-store" })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((user) => setState({ loading: false, user }))
      .catch(() => setState({ loading: false, user: null }));
  }, []);

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Close mobile menu when clicking outside
  useEffect(() => {
    if (!mobileOpen) return;
    function handle(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node))
        setMobileOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [mobileOpen]);

  // Lock body scroll while mobile menu is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  // Client-side route enforcement — second layer after middleware
  useEffect(() => {
    if (state.loading || !state.user) return;
    if (!hasStaffRole(state.user)) return; // "no staff role" gate renders instead
    if (!canVisit(state.user, pathname)) {
      router.replace(fallbackPage(state.user));
    }
  }, [state, pathname, router]);

  // ── Loading ──────────────────────────────────────────────────────────────

  if (state.loading) {
    return (
      <main className="admin-gate">
        <LoaderCircle className="spin" aria-hidden="true" />
        <p>Checking access…</p>
      </main>
    );
  }

  // ── Not signed in ────────────────────────────────────────────────────────

  if (!state.user) {
    return (
      <main className="admin-gate">
        <ShieldAlert aria-hidden="true" />
        <h1>Sign in required</h1>
        <p>Sign in with a staff or administrator account to open the portal.</p>
        <Link className="primary-button" href="/login">Sign in</Link>
      </main>
    );
  }

  // ── No staff role ────────────────────────────────────────────────────────

  if (!hasStaffRole(state.user)) {
    return (
      <main className="admin-gate">
        <ShieldAlert aria-hidden="true" />
        <h1>Staff access required</h1>
        <p>
          Your account (<strong>{state.user.email}</strong>) does not have a
          staff role. Contact an administrator to request access.
        </p>
        <Link href="/" className="primary-button">Return to helpdesk</Link>
      </main>
    );
  }

  // ── Out-of-scope page — show spinner while redirect fires ────────────────

  if (!canVisit(state.user, pathname)) {
    return (
      <main className="admin-gate">
        <LoaderCircle className="spin" aria-hidden="true" />
        <p>Redirecting…</p>
      </main>
    );
  }

  // ── Authorised — render full shell ───────────────────────────────────────

  const user      = state.user;
  const role      = highestRole(user);
  const roleLabel = user.is_superuser ? "Superuser" : (ROLE_LABELS[role] ?? role);
  const badge     = ROLE_BADGE[role] ?? { text: "#475569", bg: "#f1f5f9" };
  const nav       = visibleNav(user);

  return (
    <UploadQueueProvider>
      <div className="admin-frame">
        {/* ── Desktop sidebar (hidden on mobile) ── */}
        <aside className="admin-sidebar">
          <Link href="/" className="admin-brand">
            <span>IIC</span>
            <div>
              <strong>IT &amp; NOC</strong>
              <small>Staff Portal</small>
            </div>
          </Link>

          <nav aria-label="Staff portal navigation">
            {nav.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className={pathname === href ? "active" : ""}>
                <Icon aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>

          <div className="admin-user">
            <strong>{user.name}</strong>
            <span
              style={{
                display: "inline-block", borderRadius: 999,
                padding: "2px 9px", fontSize: ".72rem", fontWeight: 800,
                color: badge.text, background: badge.bg, marginTop: 2,
              }}
            >
              {roleLabel}
            </span>
            {user.category_scope && (
              <span style={{ fontSize: ".7rem", color: "rgba(255,255,255,.55)", marginTop: 3, lineHeight: 1.4 }}>
                Scoped: {user.category_scope.join(", ")}
              </span>
            )}
            <Link href="/"><Home aria-hidden="true" /> Public helpdesk</Link>
          </div>
        </aside>

        {/* ── Mobile top bar (only on ≤640px) ── */}
        <div className="admin-mobile-bar">
          <Link href="/" className="admin-mobile-brand">
            <span>IIC</span>
            <strong>IT &amp; NOC Staff Portal</strong>
          </Link>
          <button
            type="button"
            className="admin-mobile-toggle"
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen
              ? <X size={22} aria-hidden="true" />
              : <Menu size={22} aria-hidden="true" />
            }
          </button>
        </div>

        <main className="admin-main">{children}</main>
      </div>

      {/* ── Mobile nav backdrop ── */}
      {mobileOpen && (
        <div
          className="admin-mobile-backdrop"
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile nav drawer ── */}
      <div
        ref={drawerRef}
        className={`admin-mobile-drawer${mobileOpen ? " admin-mobile-drawer--open" : ""}`}
        aria-label="Staff portal navigation"
      >
        {/* User identity */}
        <div className="admin-mobile-identity">
          <div className="admin-mobile-avatar" aria-hidden="true">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <strong style={{ display: "block", fontSize: ".9rem", color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user.name}
            </strong>
            <span style={{
              display: "inline-block", borderRadius: 999,
              padding: "1px 8px", fontSize: ".7rem", fontWeight: 800,
              color: badge.text, background: badge.bg, marginTop: 3,
            }}>
              {roleLabel}
            </span>
          </div>
        </div>

        {/* Nav links */}
        <nav aria-label="Staff portal navigation" style={{ flex: 1, overflow: "auto" }}>
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`admin-mobile-nav-link${pathname === href ? " active" : ""}`}
            >
              <Icon size={18} aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className="admin-mobile-footer">
          <Link href="/" className="admin-mobile-nav-link" style={{ color: "#94a3b8" }}>
            <Home size={16} aria-hidden="true" />
            Back to public helpdesk
          </Link>
        </div>
      </div>

      {/* Background upload progress */}
      <UploadQueueWidget />
    </UploadQueueProvider>
  );
}
