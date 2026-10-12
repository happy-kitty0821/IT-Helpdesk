import type { NextConfig } from "next";

const djangoInternal = process.env.DJANGO_INTERNAL_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  skipTrailingSlashRedirect: true,

  // ── Rewrite proxy timeout ──────────────────────────────────────────────────
  // Default is 10 s — insufficient for large file chunk uploads which write
  // to disk on the Django side.  Set to 0 to disable the timeout entirely
  // for the proxy — gunicorn handles worker-level timeouts instead.
  // Previously 120_000ms but that kills SSE streams after 2 minutes.
  experimental: {
    proxyTimeout: 0,
  },

  async headers() {
    return [
      {
        // All pages: allow same-origin framing, block cross-origin.
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        // Media files proxied from Django: strip COOP so Chrome's PDF viewer
        // can render PDFs inside an iframe.
        source: "/media/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "unsafe-none" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        // SSE stream endpoints: disable proxy buffering so events flow
        // through the Next.js local proxy to the browser in real time.
        // X-Accel-Buffering: no  — tells Nginx (if in front) not to buffer.
        // Cache-Control: no-cache — prevents any intermediate cache from
        // holding the response.
        source: "/api/v1/tickets/:id/stream",
        headers: [
          { key: "X-Accel-Buffering",  value: "no" },
          { key: "Cache-Control",       value: "no-cache" },
          { key: "Content-Type",        value: "text/event-stream" },
        ],
      },
    ];
  },
  async rewrites() {
    const d = djangoInternal;
    return [
      // /api/v1/upload/* is handled by Next.js Route Handlers under
      // app/api/v1/upload/ — do NOT add a rewrite for that path prefix
      // or the rewrite will intercept before the Route Handler runs.
      // We list every other top-level segment explicitly to avoid a
      // catch-all that would swallow the upload paths.
      { source: "/api/v1/auth/:path*",          destination: `${d}/api/v1/auth/:path*/` },
      { source: "/api/v1/services",              destination: `${d}/api/v1/services/` },
      { source: "/api/v1/services/:path*",       destination: `${d}/api/v1/services/:path*/` },
      { source: "/api/v1/tickets",               destination: `${d}/api/v1/tickets/` },
      { source: "/api/v1/tickets/:path*",        destination: `${d}/api/v1/tickets/:path*/` },
      { source: "/api/v1/guides",                destination: `${d}/api/v1/guides/` },
      { source: "/api/v1/guides/:path*",         destination: `${d}/api/v1/guides/:path*/` },
      { source: "/api/v1/software",              destination: `${d}/api/v1/software/` },
      { source: "/api/v1/software/:path*",       destination: `${d}/api/v1/software/:path*/` },
      { source: "/api/v1/status",                destination: `${d}/api/v1/status/` },
      { source: "/api/v1/status/:path*",         destination: `${d}/api/v1/status/:path*/` },
      { source: "/api/v1/announcement",          destination: `${d}/api/v1/announcement/` },
      { source: "/api/v1/announcement/:path*",   destination: `${d}/api/v1/announcement/:path*/` },
      { source: "/api/v1/admin/:path*",          destination: `${d}/api/v1/admin/:path*/` },
      { source: "/api/v1/settings/:path*",       destination: `${d}/api/v1/settings/:path*/` },
      { source: "/api/v1/health",                destination: `${d}/api/v1/health/` },
      { source: "/api/v1/health/:path*",         destination: `${d}/api/v1/health/:path*/` },
      // NOTE: /api/v1/upload/* intentionally omitted — handled by Route Handlers
      { source: "/media/:path*",                 destination: `${d}/media/:path*/` },
    ];
  },
};

export default nextConfig;