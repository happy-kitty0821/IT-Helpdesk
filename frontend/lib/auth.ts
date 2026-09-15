// All role values the backend can return
export type RoleValue =
  | "administrator" | "service_lead" | "it_agent" | "it_noc_intern"
  | "designated_approver" | "content_editor"
  | "faculty_staff" | "student" | "visitor";

export type AuthUser = {
  id: number;
  username: string;
  email: string;
  name: string;
  is_staff: boolean;
  is_superuser: boolean;
  roles: RoleValue[];
  category_scope: string[] | null; // null = no restriction; string[] = intern scope
};

// Staff roles that get access to the management portal
export const STAFF_ROLES = new Set<RoleValue>([
  "administrator", "service_lead", "it_agent", "it_noc_intern",
  "designated_approver", "content_editor",
]);

export function hasStaffRole(user: AuthUser): boolean {
  return user.is_superuser || user.roles.some((r) => STAFF_ROLES.has(r));
}

export function highestRole(user: AuthUser): RoleValue {
  const order: RoleValue[] = [
    "administrator", "service_lead", "designated_approver", "content_editor",
    "it_agent", "it_noc_intern", "faculty_staff", "student", "visitor",
  ];
  for (const r of order) {
    if (user.roles.includes(r)) return r;
  }
  return "visitor";
}

export const ROLE_LABELS: Record<RoleValue, string> = {
  administrator:       "Administrator",
  service_lead:        "Service Lead",
  it_agent:            "IT Agent",
  it_noc_intern:       "IT NOC Intern",
  designated_approver: "Designated Approver",
  content_editor:      "Content Editor",
  faculty_staff:       "Faculty / Staff",
  student:             "Student",
  visitor:             "Visitor",
};

type ApiError = { detail?: string; [field: string]: unknown };

export async function csrfToken() {
  const response = await fetch("/api/v1/auth/csrf/", { credentials: "include" });
  if (!response.ok) throw new Error("Could not start a secure sign-in session.");
  return (await response.json() as { csrfToken: string }).csrfToken;
}

export async function authPost(path: string, body: object): Promise<AuthUser> {
  const token = await csrfToken();
  const response = await fetch(`/api/v1/auth/${path}/`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRFToken": token },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as ApiError;
  if (!response.ok) {
    const fieldMessage = Object.values(data).flat().find((value) => typeof value === "string");
    throw new Error(data.detail ?? String(fieldMessage ?? "The request could not be completed."));
  }
  return data as AuthUser;
}
