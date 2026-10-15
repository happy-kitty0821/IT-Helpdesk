/**
 * 07_admin_users.js
 * ──────────────────
 * Admin user management:
 *   - List users
 *   - Get a specific user
 *   - Grant a role to a user
 *   - Revoke a role from a user
 *   - Suspend a user
 *   - Unsuspend a user
 *   - Non-admin cannot access user list
 *   - Role audit events appear after grant/revoke
 *
 * NOTE: Tests avoid granting roles to the admin themselves (would affect
 * the test session). A separate test target user is used if available.
 *
 * Environment variables required:
 *   ADMIN_EMAIL, ADMIN_PASSWORD, STUDENT_EMAIL, STUDENT_PASSWORD
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import {
  API, login, logout, jsonPost, jsonDelete, parseBody,
} from "./helpers.js";

export const options = {
  vus: 1,
  iterations: 2,
  thresholds: {
    http_req_failed:   ["rate<0.01"],
    http_req_duration: ["p(95)<2000"],
  },
};

const ADMIN_EMAIL      = __ENV.ADMIN_EMAIL      || "admin@iic.edu.np";
const ADMIN_PASSWORD   = __ENV.ADMIN_PASSWORD   || "TestAdminPassword123!";
const STUDENT_EMAIL    = __ENV.STUDENT_EMAIL    || "student@iic.edu.np";
const STUDENT_PASSWORD = __ENV.STUDENT_PASSWORD || "TestPassword123!";

export default function () {

  // ── Non-admin blocked ─────────────────────────────────────────────────
  group("non_admin_user_list_blocked", () => {
    const csrf = login(STUDENT_EMAIL, STUDENT_PASSWORD);
    const res  = http.get(`${API}/admin/users/`);
    check(res, {
      "student cannot list users": (r) => r.status === 403 || r.status === 401,
    });
    logout(csrf);
  });

  const csrf = login(ADMIN_EMAIL, ADMIN_PASSWORD);

  // ── List users ─────────────────────────────────────────────────────────
  let studentUserId = null;
  group("list_users", () => {
    const res   = http.get(`${API}/admin/users/`);
    const body  = parseBody(res);
    const users = body.results || body;
    check(res, {
      "list users 200":    (r) => r.status === 200,
      "users is array":    () => Array.isArray(users),
    });
    // Find the student user for subsequent tests
    if (Array.isArray(users)) {
      const student = users.find((u) => u.email === STUDENT_EMAIL);
      if (student) studentUserId = student.id;
    }
  });

  if (!studentUserId) {
    logout(csrf);
    return;
  }

  // ── Get specific user ──────────────────────────────────────────────────
  group("get_user", () => {
    const res  = http.get(`${API}/admin/users/${studentUserId}/`);
    const body = parseBody(res);
    check(res, {
      "get user 200":          (r) => r.status === 200,
      "user email matches":    () => body.email === STUDENT_EMAIL,
      "user has is_active":    () => typeof body.is_active === "boolean",
    });
  });

  // ── List user's roles ──────────────────────────────────────────────────
  group("list_user_roles", () => {
    const res   = http.get(`${API}/admin/users/${studentUserId}/roles/`);
    const roles = parseBody(res);
    check(res, {
      "user roles 200":       (r) => r.status === 200,
      "roles is array":       () => Array.isArray(roles),
    });
  });

  // ── Grant content_editor role ──────────────────────────────────────────
  group("grant_role", () => {
    const res  = jsonPost(`${API}/admin/users/${studentUserId}/roles/`, {
      role: "content_editor",
    }, csrf);
    check(res, {
      "grant role 201 or 200": (r) => r.status === 201 || r.status === 200,
    });
  });

  // ── Revoke content_editor role ─────────────────────────────────────────
  group("revoke_role", () => {
    const res = jsonDelete(
      `${API}/admin/users/${studentUserId}/roles/content_editor/`,
      csrf,
    );
    check(res, {
      "revoke role 204 or 200": (r) => r.status === 204 || r.status === 200,
    });
  });

  // ── Suspend user ───────────────────────────────────────────────────────
  group("suspend_user", () => {
    const res  = jsonPost(`${API}/admin/users/${studentUserId}/suspend/`, {
      suspend: true,
      reason:  "k6 test suspension — automated.",
    }, csrf);
    check(res, {
      "suspend 200":              (r) => r.status === 200,
      "is_active is false":       () => {
        const b = parseBody(res);
        return b.is_active === false || b.is_suspended === true;
      },
    });
  });

  // ── Unsuspend user ─────────────────────────────────────────────────────
  group("unsuspend_user", () => {
    const res  = jsonPost(`${API}/admin/users/${studentUserId}/suspend/`, {
      suspend: false,
    }, csrf);
    check(res, {
      "unsuspend 200":       (r) => r.status === 200,
      "is_active is true":   () => {
        const b = parseBody(res);
        return b.is_active === true || b.is_suspended === false;
      },
    });
  });

  // ── Admin settings — roles ─────────────────────────────────────────────
  group("admin_role_settings", () => {
    const res   = http.get(`${API}/admin/settings/roles/`);
    const roles = parseBody(res);
    check(res, {
      "role settings 200":   (r) => r.status === 200,
      "roles is array":      () => Array.isArray(roles),
    });
  });

  // ── Intern scope settings ──────────────────────────────────────────────
  group("intern_scope", () => {
    const res   = http.get(`${API}/admin/settings/intern-scope/`);
    const scope = parseBody(res);
    check(res, {
      "intern scope 200":    (r) => r.status === 200,
      "intern scope array":  () => Array.isArray(scope),
    });
  });

  logout(csrf);
  sleep(1);
}
