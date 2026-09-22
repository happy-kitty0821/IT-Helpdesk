import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://helpdesk.iic.edu.np";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/help", "/software", "/login", "/register", "/tickets/new"],
        // Keep personal tickets, admin portal, and API private
        disallow: [
          "/admin/",
          "/tickets/",   // individual ticket pages contain personal data
          "/api/",
          "/media/",
        ],
      },
      {
        // Block AI training scrapers that don't respect noindex
        userAgent: ["GPTBot", "ChatGPT-User", "CCBot", "anthropic-ai", "Claude-Web"],
        disallow: "/",
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host:    BASE_URL,
  };
}
