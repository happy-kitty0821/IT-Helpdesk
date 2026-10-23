import { NextRequest, NextResponse } from "next/server";

/**
 * Next.js Edge Middleware
 *
 * Purpose: Block direct browser navigation to /api/v1/* endpoints.
 *
 * When a user types https://ithelpdesk-iic.cloud-dev.tech/api/v1/tickets/
 * into their browser address bar, the browser sends:
 *   Accept: text/html,application/xhtml+xml,...
 *
 * That tells the Django REST Framework browsable renderer to return an
 * interactive HTML page instead of JSON, leaking API structure and schema.
 *
 * This middleware detects browser-originated requests (Accept: text/html as
 * the primary type) to /api/v1/* paths and redirects them to the home page.
 *
 * Legitimate API calls from the frontend use fetch() / XHR which send:
 *   Accept: application/json  or  Accept: *\/*
 * Those requests are passed through untouched to the Django proxy.
 *
 * Paths excluded from this check:
 *   /api/v1/api/docs/   — Swagger UI (intentionally HTML, admin-only)
 *   /api/v1/api/redoc/  — Redoc UI
 *   /api/v1/api/schema/ — OpenAPI schema download
 */

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only act on /api/v1/* paths
  if (!pathname.startsWith("/api/v1/")) {
    return NextResponse.next();
  }

  // Allow the Swagger/Redoc documentation endpoints through — these are
  // intentionally HTML and are protected by Django's own auth.
  if (
    pathname.startsWith("/api/v1/api/docs") ||
    pathname.startsWith("/api/v1/api/redoc") ||
    pathname.startsWith("/api/v1/api/schema")
  ) {
    return NextResponse.next();
  }

  // Check if this is a browser navigation (as opposed to a fetch/XHR call).
  // Browsers send Accept: text/html as their first/primary preference.
  // fetch() calls send Accept: */* or application/json.
  const accept = request.headers.get("accept") ?? "";
  const isBrowserNavigation =
    accept.startsWith("text/html") ||
    accept.includes("text/html,application/xhtml+xml");

  if (isBrowserNavigation) {
    // Redirect to the home page — the user navigated to an API URL directly.
    const home = new URL("/", request.url);
    return NextResponse.redirect(home, { status: 302 });
  }

  return NextResponse.next();
}

export const config = {
  // Run only on /api/v1/* — skip static assets, Next.js internals, etc.
  matcher: ["/api/v1/:path*"],
};
