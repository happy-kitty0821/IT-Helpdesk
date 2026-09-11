import type { Guide, Software } from "@/lib/admin-api";

const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000/api/v1";

async function publicGet<T>(path: string): Promise<T[]> {
  try {
    const response = await fetch(`${baseUrl}/${path}/`, { cache: "no-store" });
    if (!response.ok) return [];
    return response.json();
  } catch { return []; }
}

export const getGuides = () => publicGet<Guide>("guides");
export const getSoftware = () => publicGet<Software>("software");
