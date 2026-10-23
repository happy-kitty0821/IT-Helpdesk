import type { NextConfig } from "next";

const djangoInternal = process.env.DJANGO_INTERNAL_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  skipTrailingSlashRedirect: true,

  // Standalone output for Docker — produces a self-contained server bundle.
  // Has no effect on local pnpm dev or pnpm build outside Docker.
  output: "standalone",

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
        // All pages: security headers
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options",           value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options",     value: "nosniff" },
          { key: "Referrer-Policy",            value: "strict-origin-when-cross-origin" },
          // CSP for Next.js pages.
          // 'unsafe-inline' on style-src is required because Next.js injects
          // critical CSS via <style> tags in the document head at SSR time.
          // script-src includes accounts.google.com for Google Sign-In.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              "connect-src 'self'",
              "frame-src 'self' https://accounts.google.com",
              "frame-ancestors 'self'",
              "form-action 'self'",
              "base-uri 'self'",
              "object-src 'none'",
            ].join("; "),
          },
        ],
      },
      {
        // Media files proxied from Django: strip COOP so Chrome's PDF viewer
        // can render PDFs inside an iframe.
        source: "/media/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "unsafe-none" },
          { key: "X-Frame-Options",            value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options",     value: "nosniff" },
          { key: "Referrer-Policy",            value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  async rewrites() {
    const d = djangoInternal;
    // ── Rewrite phase notes ────────────────────────────────────────────────
    // afterFiles  — checked AFTER filesystem pages but BEFORE App Router
    //               Route Handlers in Next.js 16 production builds.
    //               Put general API proxy rules here.
    //
    // fallback    — checked AFTER everything else, including Route Handlers.
    //               The ticket and admin stream endpoints have dedicated
    //               Route Handlers (app/api/v1/tickets/[id]/stream/route.ts
    //               and app/api/v1/admin/summary/stream/route.ts) that must
    //               win over the generic :path* wildcard rewrites below.
    //               Moving those two wildcards to fallback ensures the Route
    //               Handlers are executed instead, giving us a streaming
    //               ReadableStream response instead of a buffered proxy.
    return {
      beforeFiles: [],

      afterFiles: [
        // /api/v1/upload/* is handled by Next.js Route Handlers —
        // intentionally omitted so rewrites never intercept uploads.
        { source: "/api/v1/auth/:path*",          destination: `${d}/api/v1/auth/:path*/` },
        { source: "/api/v1/services",              destination: `${d}/api/v1/services/` },
        { source: "/api/v1/services/:path*",       destination: `${d}/api/v1/services/:path*/` },
        { source: "/api/v1/tickets",               destination: `${d}/api/v1/tickets/` },
        { source: "/api/v1/guides",                destination: `${d}/api/v1/guides/` },
        { source: "/api/v1/guides/:path*",         destination: `${d}/api/v1/guides/:path*/` },
        { source: "/api/v1/software",              destination: `${d}/api/v1/software/` },
        { source: "/api/v1/software/:path*",       destination: `${d}/api/v1/software/:path*/` },
        { source: "/api/v1/status",                destination: `${d}/api/v1/status/` },
        { source: "/api/v1/status/:path*",         destination: `${d}/api/v1/status/:path*/` },
        { source: "/api/v1/announcement",          destination: `${d}/api/v1/announcement/` },
        { source: "/api/v1/announcement/:path*",   destination: `${d}/api/v1/announcement/:path*/` },
        { source: "/api/v1/settings/:path*",       destination: `${d}/api/v1/settings/:path*/` },
        { source: "/api/v1/health",                destination: `${d}/api/v1/health/` },
        { source: "/api/v1/health/:path*",         destination: `${d}/api/v1/health/:path*/` },
        { source: "/media/:path*",                 destination: `${d}/media/:path*/` },
      ],

      // Fallback rewrites run AFTER Route Handlers.
      // /api/v1/tickets/:path* and /api/v1/admin/:path* are here so that:
      //   • /api/v1/tickets/{id}/stream/         → Route Handler (streaming)
      //   • /api/v1/admin/summary/stream/        → Route Handler (streaming)
      //   • All other /api/v1/tickets/* paths    → Django via this rewrite
      //   • All other /api/v1/admin/* paths      → Django via this rewrite
      fallback: [
        { source: "/api/v1/tickets/:path*",        destination: `${d}/api/v1/tickets/:path*/` },
        { source: "/api/v1/admin/:path*",          destination: `${d}/api/v1/admin/:path*/` },
      ],
    };
  },
};

export default nextConfig;