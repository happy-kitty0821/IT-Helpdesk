import type { Guide, Software } from "@/lib/admin-api";

// Server-side fetches go directly to Django. build_absolute_uri returns
// http://127.0.0.1:8000/media/... so we strip the origin so the browser
// resolves the path through the Next.js proxy at localhost:3000.
const serverBase = "http://127.0.0.1:8000/api/v1";

function rewriteMediaUrls<T>(obj: T): T {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(rewriteMediaUrls) as unknown as T;
  const result = {} as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof value === "string" && value.startsWith("http://127.0.0.1:8000/media/")) {
      result[key] = value.replace("http://127.0.0.1:8000", "");
    } else {
      result[key] = rewriteMediaUrls(value);
    }
  }
  return result as T;
}

async function publicGet<T>(path: string): Promise<T[]> {
  try {
    const response = await fetch(`${serverBase}/${path}/`, { cache: "no-store" });
    if (!response.ok) return [];
    const data = await response.json();
    return rewriteMediaUrls(data);
  } catch { return []; }
}

export const getGuides = () => publicGet<Guide>("guides");
export const getSoftware = () => publicGet<Software>("software");
