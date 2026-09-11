export type AuthUser = {
  id: number;
  username: string;
  email: string;
  name: string;
  is_staff: boolean;
  is_superuser: boolean;
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
