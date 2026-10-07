import { NextRequest, NextResponse } from "next/server";

// ── Route permission map ──────────────────────────────────────────────────────

const ROUTE_ROLES: Array<{ prefix: string; allowed: string[] }> = [
  { prefix: "/admin/users",         allowed: ["administrator", "superuser"] },
  { prefix: "/admin/roles",         allowed: ["administrator", "superuser"] },
  { prefix: "/admin/settings",      allowed: ["administrator", "superuser"] },
  { prefix: "/admin/notifications", allowed: ["administrator", "service_lead", "superuser"] },
  { prefix: "/admin/services",      allowed: ["administrator", "service_lead", "content_editor", "superuser"] },
  { prefix: "/admin/guides",        allowed: ["administrator", "service_lead", "content_editor", "superuser"] },
  { prefix: "/admin/software",      allowed: ["administrator", "service_lead", "content_editor", "superuser"] },
  { prefix: "/admin",               allowed: [
      "administrator", "service_lead", "it_agent", "it_noc_intern",
      "designated_approver", "content_editor", "superuser",
    ],
  },
];

const ROLE_FALLBACK: Record<string, string> = {
  administrator:       "/admin",
  service_lead:        "/admin",
  it_agent:            "/admin/tickets",
  it_noc_intern:       "/admin/tickets",
  designated_approver: "/admin/tickets",
  content_editor:      "/admin/guides",
  superuser:           "/admin",
};

const NON_STAFF_FALLBACK = "/";

// ── Middleware ────────────────────────────────────────────────────────────────

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/admin")) return NextResponse.next();

  const djangoBase = process.env.DJANGO_INTERNAL_URL ?? "http://127.0.0.1:8000";

  let roles: string[] = [];
  let isSuperuser = false;
  let djangoReachable = false;

  try {
    const cookieHeader = request.headers.get("cookie") ?? "";
    const meRes = await fetch(`${djangoBase}/api/v1/auth/me/`, {
      headers: { cookie: cookieHeader },
      signal: AbortSignal.timeout(4000),
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
        djangoReachable = true;
      }
    } else if (meRes.status === 401 || meRes.status === 403) {
      // Definitive "not authenticated" response — Django is up and said no
      djangoReachable = true;
    }
    // Any other non-ok status (5xx etc.) → treat as unreachable, allow through
  } catch {
    // Django unreachable (timeout, ECONNREFUSED, etc.) — let the client-side
    // AdminShell handle auth rather than incorrectly blocking the user.
    djangoReachable = false;
  }

  // If we couldn't confirm identity, allow through — AdminShell will gate client-side
  if (!djangoReachable) return NextResponse.next();

  const effectiveRoles = isSuperuser ? [...roles, "superuser"] : roles;

  // Find the most-specific matching rule
  const rule = ROUTE_ROLES.find((r) => pathname.startsWith(r.prefix));
  if (!rule) return NextResponse.next();

  const isAllowed = rule.allowed.some((r) => effectiveRoles.includes(r));
  if (isAllowed) return NextResponse.next();

  // Redirect to the appropriate fallback
  const fallback = effectiveRoles.reduce<string | null>((best, role) => {
    if (best) return best;
    return ROLE_FALLBACK[role] ?? null;
  }, null) ?? NON_STAFF_FALLBACK;

  const target = fallback === pathname ? NON_STAFF_FALLBACK : fallback;
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = target;

  return NextResponse.redirect(redirectUrl, { status: 307 });
}

export const config = {
  matcher: ["/admin/:path*"],
};
