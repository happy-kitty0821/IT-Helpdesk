/**
 * 02_auth.js
 * ──────────
 * Authentication flows:
 *   - Login with valid credentials
 *   - Login with wrong password → 401
 *   - GET /auth/me/ while authenticated
 *   - GET /auth/me/ while unauthenticated → 401
 *   - GET /auth/profile/ while authenticated
 *   - PATCH /auth/profile/ (name update)
 *   - POST /auth/forgot-password/ (email enumeration guard — always 200)
 *   - Logout
 *
 * Environment variables required:
 *   STUDENT_EMAIL, STUDENT_PASSWORD
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { API, getCsrf, login, logout, jsonPost, jsonPatch, parseBody } from "./helpers.js";

export const options = {
  vus: 1,
  iterations: 3,
  thresholds: {
    http_req_failed:   ["rate<0.01"],
    http_req_duration: ["p(95)<1000"],
  },
};

const STUDENT_EMAIL    = __ENV.STUDENT_EMAIL    || "student@iic.edu.np";
const STUDENT_PASSWORD = __ENV.STUDENT_PASSWORD || "TestPassword123!";

export default function () {

  // ── Unauthenticated /me/ ──────────────────────────────────────────────
  group("me_unauthenticated", () => {
    const res = http.get(`${API}/auth/me/`);
    check(res, {
      "unauthenticated me 401 or 403": (r) => r.status === 401 || r.status === 403,
    });
  });

  // ── Bad login ──────────────────────────────────────────────────────────
  group("login_wrong_password", () => {
    const csrf = getCsrf();
    const res  = jsonPost(`${API}/auth/login/`, {
      identifier: STUDENT_EMAIL,
      password:   "definitelywrongpassword!!",
    }, csrf);
    check(res, {
      "bad login 401": (r) => r.status === 400 || r.status === 401,
    });
  });

  // ── Valid login ────────────────────────────────────────────────────────
  let csrf;
  let myId;

  group("login_valid", () => {
    csrf = login(STUDENT_EMAIL, STUDENT_PASSWORD);
  });

  // ── /me/ while authenticated ───────────────────────────────────────────
  group("me_authenticated", () => {
    const res  = http.get(`${API}/auth/me/`);
    const body = parseBody(res);
    check(res, {
      "me 200":              (r) => r.status === 200,
      "me has id":           () => typeof body.id === "number",
      "me has email":        () => typeof body.email === "string",
      "me has roles array":  () => Array.isArray(body.roles),
    });
    myId = body.id;
  });

  // ── Profile read ───────────────────────────────────────────────────────
  group("profile_get", () => {
    const res  = http.get(`${API}/auth/profile/`);
    const body = parseBody(res);
    check(res, {
      "profile 200":                   (r) => r.status === 200,
      "profile has username":          () => typeof body.username === "string",
      "profile has programme_locked":  () => typeof body.programme_locked === "boolean",
    });
  });

  // ── Profile update ─────────────────────────────────────────────────────
  group("profile_patch", () => {
    const res = jsonPatch(`${API}/auth/profile/`, {
      first_name: "K6Test",
      last_name:  "User",
      department: "IT Department",
    }, csrf);
    check(res, {
      "profile PATCH 200": (r) => r.status === 200,
    });
  });

  // ── Forgot password (enumeration guard) ───────────────────────────────
  group("forgot_password", () => {
    const csrf2 = getCsrf();
    const res   = jsonPost(`${API}/auth/forgot-password/`, {
      email: "doesnotexist@iic.edu.np",
    }, csrf2);
    // Always returns 200 regardless of whether account exists
    check(res, {
      "forgot-password 200 (no enumeration)": (r) => r.status === 200,
    });
  });

  // ── Logout ─────────────────────────────────────────────────────────────
  group("logout", () => {
    logout(csrf);
    const res = http.get(`${API}/auth/me/`);
    check(res, {
      "after logout me is 401/403": (r) => r.status === 401 || r.status === 403,
    });
  });

  sleep(1);
}
