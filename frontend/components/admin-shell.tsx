"use client";

import {
  Bell, BookOpen, Boxes, CircleDot, Gauge,
  Home, LayoutGrid, LoaderCircle, ShieldAlert, Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  hasStaffRole, highestRole, ROLE_LABELS,
  type AuthUser, type RoleValue,
} from "@/lib/auth";

// ── Nav item definition ───────────────────────────────────────────────────────

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  /** Roles that can see this item. Empty = all staff. */
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
];

/** Filter nav items to those the given user may see. */
function visibleNav(user: AuthUser): NavItem[] {
  if (user.is_superuser) return ALL_NAV; // superusers see everything

  return ALL_NAV.filter(({ allowedRoles }) => {
    if (!allowedRoles || allowedRoles.length === 0) return true; // open to all staff
    return user.roles.some((r) => allowedRoles.includes(r));
  });
}

// ── Role badge colour ─────────────────────────────────────────────────────────

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
  const [state, setState] = useState<{ loading: boolean; user: AuthUser | null }>({
    loading: true,
    user: null,
  });

  useEffect(() => {
    fetch("/api/v1/auth/me/", { credentials: "include", cache: "no-store" })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((user) => setState({ loading: false, user }))
      .catch(() => setState({ loading: false, user: null }));
  }, []);

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

  // ── Signed in but no staff role ──────────────────────────────────────────

  if (!hasStaffRole(state.user)) {
    return (
      <main className="admin-gate">
        <ShieldAlert aria-hidden="true" />
        <h1>Staff access required</h1>
        <p>
          Your account (<strong>{state.user.email}</strong>) does not have a staff role.
          Contact an administrator to request access.
        </p>
        <Link href="/" className="primary-button">Return to helpdesk</Link>
      </main>
    );
  }

  // ── Authorised — render shell ─────────────────────────────────────────────

  const user = state.user;
  const role = highestRole(user);
  const roleLabel = user.is_superuser ? "Superuser" : (ROLE_LABELS[role] ?? role);
  const badge = ROLE_BADGE[role] ?? { text: "#475569", bg: "#f1f5f9" };
  const nav = visibleNav(user);

  return (
    <div className="admin-frame">
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
            <Link
              key={href}
              href={href}
              className={pathname === href ? "active" : ""}
            >
              <Icon aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>

        <div className="admin-user">
          <strong>{user.name}</strong>
          {/* Role badge */}
          <span
            style={{
              display: "inline-block",
              borderRadius: 999,
              padding: "2px 9px",
              fontSize: ".72rem",
              fontWeight: 800,
              color: badge.text,
              background: badge.bg,
              marginTop: 2,
            }}
          >
            {roleLabel}
          </span>
          {/* Scope notice for interns */}
          {user.category_scope && (
            <span
              style={{
                fontSize: ".7rem",
                color: "rgba(255,255,255,.55)",
                marginTop: 3,
                lineHeight: 1.4,
              }}
            >
              Scoped to: {user.category_scope.join(", ")}
            </span>
          )}
          <Link href="/">
            <Home aria-hidden="true" /> Public helpdesk
          </Link>
        </div>
      </aside>

      <main className="admin-main">{children}</main>
    </div>
  );
}
