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

export const ALL_ROLES = [
  { value: "administrator",       label: "Administrator",       description: "Full access to this management panel." },
  { value: "service_lead",        label: "Service Lead",        description: "Triage, assign, escalate and run team reports." },
  { value: "it_agent",            label: "IT Agent",            description: "Work assigned queues, post replies and internal notes." },
  { value: "it_noc_intern",       label: "IT NOC Intern",       description: "IT Agent scoped to Laptop, Wi-Fi and General IT tickets." },
  { value: "designated_approver", label: "Designated Approver", description: "Review approval tasks for ID replacement and CCTV tickets." },
  { value: "content_editor",      label: "Content Editor",      description: "Draft, revise and publish guides and announcements." },
  { value: "faculty_staff",       label: "Faculty / Staff",     description: "Access staff-eligible services and guides." },
  { value: "student",             label: "Student",             description: "Submit requests and access student resources." },
  { value: "visitor",             label: "Visitor",             description: "Public-only access (unauthenticated default)." },
] as const;

export type RoleValue = typeof ALL_ROLES[number]["value"];

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
  roles: RoleValue[];
};

export type RoleGrant = {
  id: number;
  role: RoleValue;
  granted_by: number | null;
  granted_by_name: string | null;
  granted_at: string;
  expires_at: string | null;
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

/** Fetch the active role grants for a user. */
export async function getUserRoles(userId: number): Promise<RoleGrant[]> {
  const response = await fetch(`/api/v1/admin/users/${userId}/roles/`, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error("Could not load role grants.");
  return response.json();
}

/** Grant a role to a user. */
export async function grantRole(userId: number, role: RoleValue): Promise<RoleGrant> {
  const token = await csrfToken();
  const response = await fetch(`/api/v1/admin/users/${userId}/roles/`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRFToken": token },
    body: JSON.stringify({ role, expires_at: null }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(messageFrom(data));
  return data as RoleGrant;
}

/** Revoke a role from a user. */
export async function revokeRole(userId: number, role: RoleValue): Promise<void> {
  const token = await csrfToken();
  const response = await fetch(`/api/v1/admin/users/${userId}/roles/${role}/`, {
    method: "DELETE",
    credentials: "include",
    headers: { "X-CSRFToken": token },
  });
  if (!response.ok && response.status !== 404) {
    const data = await response.json().catch(() => ({}));
    throw new Error(messageFrom(data));
  }
}