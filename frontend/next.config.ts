import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: "/api/v1/:path*", destination: "http://127.0.0.1:8000/api/v1/:path*" },
      { source: "/media/:path*", destination: "http://127.0.0.1:8000/media/:path*" },
    ];
  },
};

export default nextConfig;
