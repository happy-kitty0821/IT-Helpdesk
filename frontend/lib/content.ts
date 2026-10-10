import type { Guide, Software } from "@/lib/admin-api";

// Server-side fetches go directly to Django. build_absolute_uri returns
// the Django origin so we strip it so the browser resolves all paths
// through the Next.js proxy at localhost:3000.
const djangoOrigin = process.env.DJANGO_INTERNAL_URL ?? "http://127.0.0.1:8000";
const serverBase = `${djangoOrigin}/api/v1`;

function rewriteServerUrls<T>(obj: T): T {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(rewriteServerUrls) as unknown as T;
  const result = {} as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    // Strip the Django dev origin from any absolute URL the server produces
    // (covers both /media/... and /api/v1/... paths).
    if (typeof value === "string" && value.startsWith(djangoOrigin)) {
      result[key] = value.slice(djangoOrigin.length);
    } else {
      result[key] = rewriteServerUrls(value);
    }
  }
  return result as T;
}

async function publicGet<T>(path: string): Promise<T[]> {
  try {
    const response = await fetch(`${serverBase}/${path}/`, { cache: "no-store" });
    if (!response.ok) return [];
    const data = await response.json();
    return rewriteServerUrls(data);
  } catch { return []; }
}

export const getGuides = () => publicGet<Guide>("guides");
export const getSoftware = () => publicGet<Software>("software");
