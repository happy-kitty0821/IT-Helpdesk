import { csrfToken } from "@/lib/auth";

export type Guide = {
  id: number;
  title: string;
  slug: string;
  summary: string;
  pdf_url: string | null;
  pdf_name: string | null;
  pdf_size: number;
  audience: "public" | "student" | "staff" | "all";
  tags: string[];
  status: "draft" | "published" | "archived";
  reviewed_at: string | null;
  updated_by_name: string | null;
  updated_at: string;
};

export type ManagedUser = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  name: string;
  is_active: boolean;
  is_staff: boolean;
  is_superuser: boolean;
  date_joined: string;
  last_login: string | null;
};

export type Software = {
  id: number;
  name: string;
  slug: string;
  description: string;
  version: string;
  platforms: string[];
  audience: "public" | "student" | "staff" | "all";
  licence_notes: string;
  download_url: string;
  guide: number | null;
  guide_title: string | null;
  status: "draft" | "active" | "archived";
  updated_by_name: string | null;
  updated_at: string;
};

export type AdminSummary = {
  users: number;
  tickets: number;
  open_tickets: number;
  guides: number;
  published_guides: number;
  software: number;
  active_software: number;
};

type Paginated<T> = { results: T[] };

function messageFrom(data: unknown) {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.detail === "string") return record.detail;
    for (const value of Object.values(record)) {
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    }
  }
  return "The change could not be saved.";
}

export async function adminGet<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v1/admin/${path}/`, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 403 ? "Superuser access is required." : "Admin data could not be loaded.");
  const data = await response.json();
  if (data && typeof data === "object" && "results" in data) return (data as Paginated<unknown>).results as T;
  return data as T;
}

export async function adminSave<T>(path: string, body: object | FormData, id?: number): Promise<T> {
  const token = await csrfToken();
  const isFormData = body instanceof FormData;
  const response = await fetch(`/api/v1/admin/${path}/${id ?? ""}`, {
    method: id ? "PATCH" : "POST",
    credentials: "include",
    headers: isFormData ? { "X-CSRFToken": token } : { "Content-Type": "application/json", "X-CSRFToken": token },
    body: isFormData ? body : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(messageFrom(data));
  return data as T;
}
