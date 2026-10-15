/**
 * k6/helpers.js
 * Shared utilities used across all test files.
 */

import http from "k6/http";
import { check, fail } from "k6";

// ── Config ──────────────────────────────────────────────────────────────────

export const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:8000";
export const API      = `${BASE_URL}/api/v1`;

// ── CSRF ─────────────────────────────────────────────────────────────────────

/**
 * Fetch a CSRF token.  k6's cookie jar automatically retains the csrftoken
 * cookie; this function returns the token value so it can be sent as a header.
 */
export function getCsrf() {
  const res = http.get(`${API}/auth/csrf/`);
  check(res, { "csrf 200": (r) => r.status === 200 });
  // The token is set as a cookie by Django
  const jar = http.cookieJar();
  const cookies = jar.cookiesForURL(BASE_URL);
  return (cookies.csrftoken && cookies.csrftoken[0]) || "";
}

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * Log in with identifier (email or username) and password.
 * Returns the CSRF token after login so subsequent writes can use it.
 * The session cookie is stored in k6's default cookie jar.
 */
export function login(identifier, password) {
  const csrf = getCsrf();
  const res = http.post(
    `${API}/auth/login/`,
    JSON.stringify({ identifier, password }),
    {
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken":  csrf,
      },
    }
  );
  const ok = check(res, {
    "login 200": (r) => r.status === 200,
    "login returns user id": (r) => {
      try { return JSON.parse(r.body).id > 0; } catch { return false; }
    },
  });
  if (!ok) fail(`Login failed for ${identifier}: ${res.status} ${res.body}`);
  return getCsrf(); // refreshed CSRF after login
}

/**
 * Log out the current session.
 */
export function logout(csrf) {
  http.post(`${API}/auth/logout/`, null, {
    headers: { "X-CSRFToken": csrf },
  });
}

// ── JSON helpers ─────────────────────────────────────────────────────────────

export function jsonPost(url, body, csrf, extraHeaders = {}) {
  return http.post(url, JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken":  csrf,
      ...extraHeaders,
    },
  });
}

export function jsonPatch(url, body, csrf) {
  return http.patch(url, JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken":  csrf,
    },
  });
}

export function jsonDelete(url, csrf) {
  return http.del(url, null, {
    headers: { "X-CSRFToken": csrf },
  });
}

// ── Assertions ────────────────────────────────────────────────────────────────

export function assertStatus(res, expected, label) {
  check(res, {
    [`${label} status ${expected}`]: (r) => r.status === expected,
  });
}

export function parseBody(res) {
  try { return JSON.parse(res.body); } catch { return {}; }
}
