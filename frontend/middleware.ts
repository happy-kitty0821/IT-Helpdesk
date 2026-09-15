import { NextRequest, NextResponse } from "next/server";

// ── Route permission map ──────────────────────────────────────────────────────
//
// Each entry defines which roles may visit that exact path prefix.
// Checked in order — first match wins.
// "superuser" is a special sentinel meaning is_superuser=true.

const ROUTE_ROLES: Array<{ prefix: string; allowed: string[] }> = [
  { prefix: "/admin/users",         allowed: ["administrator", "superuser"] },
  { prefix: "/admin/notifications", allowed: ["administrator", "service_lead", "superuser"] },
  { prefix: "/admin/services",      allowed: ["administrator", "service_lead", "content_editor", "superuser"] },
  { prefix: "/admin/guides",        allowed: ["administrator", "service_lead", "content_editor", "superuser"] },
  { prefix: "/admin/software",      allowed: ["administrator", "service_lead", "content_editor", "superuser"] },
  // /admin, /admin/tickets, /admin/overview — accessible to all staff roles
  { prefix: "/admin",               allowed: [
      "administrator", "service_lead", "it_agent", "it_noc_intern",
      "designated_approver", "content_editor", "superuser",
    ],
  },
];

// The "home" page each role lands on when redirected away from a forbidden route
const ROLE_FALLBACK: Record<string, string> = {
  administrator:       "/admin",
  service_lead:        "/admin",
  it_agent:            "/admin/tickets",
  it_noc_intern:       "/admin/tickets",
  designated_approver: "/admin/tickets",
  content_editor:      "/admin/guides",
  superuser:           "/admin",
};

// Non-staff users are sent back to the public helpdesk
const NON_STAFF_FALLBACK = "/";

// ── Middleware ────────────────────────────────────────────────────────────────

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only guard /admin routes
  if (!pathname.startsWith("/admin")) return NextResponse.next();

  // ── Resolve Django session → user roles ────────────────────────────────
  // The rewrite rule in next.config.ts maps /api/v1/* → Django, but
  // middleware runs before rewrites, so we call Django directly.
  const djangoBase = process.env.DJANGO_INTERNAL_URL ?? "http://127.0.0.1:8000";

  let roles: string[] = [];
  let isSuperuser = false;

  try {
    // Forward the session cookie so Django can identify the caller
    const cookieHeader = request.headers.get("cookie") ?? "";
    const meRes = await fetch(`${djangoBase}/api/v1/auth/me/`, {
      headers: { cookie: cookieHeader },
      // Short timeout — if Django is down we fall through to the error path
      signal: AbortSignal.timeout(3000),
    });

    if (meRes.ok) {
      const me = await meRes.json() as {
        id?: number;
        roles?: string[];
        is_superuser?: boolean;
      };
      if (me.id) {
        roles = me.roles ?? [];
        isSuperuser = me.is_superuser ?? false;
      }
    }
  } catch {
    // Django unreachable — block access silently; the page will show
    // the "sign in required" gate instead of a hard error.
  }

  const effectiveRoles = isSuperuser ? [...roles, "superuser"] : roles;

  // ── Find the matching route rule ───────────────────────────────────────
  const rule = ROUTE_ROLES.find((r) => pathname.startsWith(r.prefix));

  if (!rule) return NextResponse.next(); // no rule = no restriction

  const isAllowed = rule.allowed.some((r) => effectiveRoles.includes(r));

  if (isAllowed) return NextResponse.next();

  // ── Redirect to the appropriate fallback ───────────────────────────────
  // Find the best fallback for this user's highest role
  const fallback = effectiveRoles.reduce<string | null>((best, role) => {
    if (best) return best;
    return ROLE_FALLBACK[role] ?? null;
  }, null) ?? NON_STAFF_FALLBACK;

  // Avoid redirect loops: if the fallback IS the current path, go home
  const target = fallback === pathname ? NON_STAFF_FALLBACK : fallback;

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = target;

  // Use 307 (temporary) so browsers don't cache the redirect
  return NextResponse.redirect(redirectUrl, { status: 307 });
}

export const config = {
  // Run on all /admin/* routes, including nested paths
  matcher: ["/admin/:path*"],
};
