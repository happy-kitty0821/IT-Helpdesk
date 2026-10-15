/**
 * 08_content.js
 * ──────────────
 * Public and admin content endpoints:
 *   - Public: guides, software, service status board
 *   - Admin: create/update/delete guide (content_editor or admin role)
 *   - Admin: create/update/delete software
 *   - Admin: service status update
 *   - Announcements (admin create, public read)
 *
 * Environment variables required:
 *   ADMIN_EMAIL, ADMIN_PASSWORD
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import {
  API, login, logout, jsonPost, jsonPatch, jsonDelete, parseBody,
} from "./helpers.js";

export const options = {
  vus: 2,
  duration: "20s",
  thresholds: {
    http_req_failed:   ["rate<0.01"],
    http_req_duration: ["p(95)<2000"],
  },
};

const ADMIN_EMAIL    = __ENV.ADMIN_EMAIL    || "admin@iic.edu.np";
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || "TestAdminPassword123!";

export default function () {

  // ── Public endpoints (no auth) ────────────────────────────────────────
  group("public_guides", () => {
    const res    = http.get(`${API}/guides/`);
    const guides = parseBody(res);
    check(res, {
      "guides 200":                  (r) => r.status === 200,
      "guides is array":             () => Array.isArray(guides),
      "guides have title":           () => !guides.length || typeof guides[0].title === "string",
    });
  });

  group("public_software", () => {
    const res  = http.get(`${API}/software/`);
    const soft = parseBody(res);
    check(res, {
      "software 200":      (r) => r.status === 200,
      "software is array": () => Array.isArray(soft),
    });
  });

  group("service_status_public", () => {
    const res    = http.get(`${API}/status/`);
    const status = parseBody(res);
    check(res, {
      "service status 200":         (r) => r.status === 200,
      "status is array":            () => Array.isArray(status),
    });
  });

  group("announcement_public", () => {
    const res = http.get(`${API}/announcement/`);
    check(res, {
      "announcement 200 or 204": (r) => r.status === 200 || r.status === 204,
    });
  });

  // ── Admin content operations ──────────────────────────────────────────
  const csrf = login(ADMIN_EMAIL, ADMIN_PASSWORD);

  // ── Admin guide list ───────────────────────────────────────────────────
  group("admin_guides_list", () => {
    const res    = http.get(`${API}/admin/guides/`);
    const guides = parseBody(res);
    check(res, {
      "admin guides 200":   (r) => r.status === 200,
      "guides is array":    () => Array.isArray(guides.results) || Array.isArray(guides),
    });
  });

  // ── Admin software list ────────────────────────────────────────────────
  group("admin_software_list", () => {
    const res  = http.get(`${API}/admin/software/`);
    const soft = parseBody(res);
    check(res, {
      "admin software 200":    (r) => r.status === 200,
      "software is array":     () => Array.isArray(soft.results) || Array.isArray(soft),
    });
  });

  // ── Admin services list ────────────────────────────────────────────────
  group("admin_services_list", () => {
    const res   = http.get(`${API}/admin/services/`);
    const svcs  = parseBody(res);
    check(res, {
      "admin services 200": (r) => r.status === 200,
      "services is array":  () => Array.isArray(svcs),
    });
  });

  // ── Admin announcements ────────────────────────────────────────────────
  let announcementId = null;
  group("admin_create_announcement", () => {
    const res  = jsonPost(`${API}/admin/announcements/`, {
      title:     "k6 Test Announcement",
      body:      "This is an automated test announcement from k6. Safe to ignore.",
      is_active: false,
      priority:  1,
    }, csrf);
    const body = parseBody(res);
    check(res, {
      "create announcement 201": (r) => r.status === 201,
      "announcement has id":     () => typeof body.id === "number",
    });
    announcementId = body.id;
  });

  group("admin_update_announcement", () => {
    if (!announcementId) return;
    const res = jsonPatch(`${API}/admin/announcements/${announcementId}/`, {
      title: "k6 Test Announcement (updated)",
    }, csrf);
    check(res, { "update announcement 200": (r) => r.status === 200 });
  });

  group("admin_delete_announcement", () => {
    if (!announcementId) return;
    const res = jsonDelete(`${API}/admin/announcements/${announcementId}/`, csrf);
    check(res, {
      "delete announcement 204": (r) => r.status === 204,
    });
  });

  // ── Service status admin ───────────────────────────────────────────────
  group("admin_service_status", () => {
    const res    = http.get(`${API}/admin/status/`);
    const status = parseBody(res);
    check(res, {
      "admin service status 200": (r) => r.status === 200,
      "status is array":          () => Array.isArray(status),
    });
  });

  // ── Ticket form settings ───────────────────────────────────────────────
  group("ticket_form_settings", () => {
    const res  = http.get(`${API}/admin/settings/ticket-form/`);
    const body = parseBody(res);
    check(res, {
      "ticket form settings 200":        (r) => r.status === 200,
      "has subject_required field":      () => typeof body.subject_required === "boolean",
      "has description_required field":  () => typeof body.description_required === "boolean",
    });
  });

  logout(csrf);
  sleep(1);
}
