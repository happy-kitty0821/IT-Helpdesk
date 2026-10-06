import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  skipTrailingSlashRedirect: true,

  // ── Rewrite proxy timeout ──────────────────────────────────────────────────
  // Default is 10 s — insufficient for large file chunk uploads which write
  // to disk on the Django side.  Set to 120 s to match Gunicorn's timeout.
  experimental: {
    proxyTimeout: 120_000,
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
        // can render PDFs inside an iframe. COOP is a document-isolation
        // header that is irrelevant for static binary assets.
        source: "/media/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "unsafe-none" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      { source: "/api/v1/:path*", destination: "http://127.0.0.1:8000/api/v1/:path*/" },
      { source: "/media/:path*",  destination: "http://127.0.0.1:8000/media/:path*/" },
    ];
  },
};

export default nextConfig;