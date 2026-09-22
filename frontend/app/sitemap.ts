import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://helpdesk.iic.edu.np";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static public routes
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/`,         lastModified: new Date(), changeFrequency: "daily",   priority: 1.0 },
    { url: `${BASE_URL}/help`,     lastModified: new Date(), changeFrequency: "weekly",  priority: 0.8 },
    { url: `${BASE_URL}/software`, lastModified: new Date(), changeFrequency: "weekly",  priority: 0.7 },
    { url: `${BASE_URL}/login`,    lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE_URL}/register`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.4 },
    // New ticket form — useful for search engines to surface the "Request support" entry point
    { url: `${BASE_URL}/tickets/new`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
  ];

  // Dynamic service slugs — fetch from the public API
  // Falls back gracefully when the backend is unreachable at build time
  let serviceRoutes: MetadataRoute.Sitemap = [];
  try {
    const res = await fetch(`${BASE_URL}/api/v1/services/`, {
      next: { revalidate: 3600 }, // re-fetch at most once per hour during ISR
    });
    if (res.ok) {
      const services = await res.json() as { slug: string; updated_at?: string }[];
      serviceRoutes = services.map((s) => ({
        url:              `${BASE_URL}/tickets/new?service=${s.slug}`,
        lastModified:     s.updated_at ? new Date(s.updated_at) : new Date(),
        changeFrequency:  "monthly" as const,
        priority:         0.65,
      }));
    }
  } catch {
    // silently skip dynamic routes when backend is offline
  }

  return [...staticRoutes, ...serviceRoutes];
}
