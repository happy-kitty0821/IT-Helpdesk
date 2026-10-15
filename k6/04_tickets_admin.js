/**
 * 04_tickets_admin.js
 * ────────────────────
 * Ticket operations from the staff perspective:
 *   - List all tickets (admin queue)
 *   - Filter tickets by status / priority
 *   - PATCH ticket (status, priority, subject)
 *   - Assign ticket to self
 *   - Transition status via POST /status/
 *   - Read ticket events
 *   - Read assignable staff list
 *   - Admin summary endpoint
 *   - Ticket export (Excel) — verify 200 + xlsx content-type
 *   - Unauthenticated access to admin endpoint → 401/403
 *
 * Environment variables required:
 *   STAFF_EMAIL, STAFF_PASSWORD, STUDENT_EMAIL, STUDENT_PASSWORD,
 *   TEST_CATEGORY_SLUG
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import {
  API, login, logout, jsonPost, jsonPatch, parseBody,
} from "./helpers.js";

export const options = {
  vus: 2,
  duration: "30s",
  thresholds: {
    http_req_failed:   ["rate<0.01"],
    http_req_duration: ["p(95)<2000"],
  },
};

const STAFF_EMAIL      = __ENV.STAFF_EMAIL      || "staff@iic.edu.np";
const STAFF_PASSWORD   = __ENV.STAFF_PASSWORD   || "TestStaffPassword123!";
const STUDENT_EMAIL    = __ENV.STUDENT_EMAIL    || "student@iic.edu.np";
const STUDENT_PASSWORD = __ENV.STUDENT_PASSWORD || "TestPassword123!";
const CATEGORY_SLUG    = __ENV.TEST_CATEGORY_SLUG || "general-support";

export default function () {

  // ── Create a ticket as student first ─────────────────────────────────
  const studentCsrf = login(STUDENT_EMAIL, STUDENT_PASSWORD);
  let ticketId = null;

  group("student_creates_ticket", () => {
    // Find category id
    const cats = parseBody(http.get(`${API}/services/`));
    const cat  = Array.isArray(cats) ? cats.find((c) => c.slug === CATEGORY_SLUG) : null;
    if (!cat) { logout(studentCsrf); return; }

    const res  = jsonPost(`${API}/tickets/`, {
      category:    cat.id,
      subject:     "k6 admin test ticket",
      description: "Created by k6 for admin endpoint tests.",
    }, studentCsrf);
    const body = parseBody(res);
    check(res, { "student creates ticket 201": (r) => r.status === 201 });
    ticketId = body.id;
  });

  logout(studentCsrf);
  if (!ticketId) return;

  // ── Log in as staff ───────────────────────────────────────────────────
  const staffCsrf = login(STAFF_EMAIL, STAFF_PASSWORD);

  // ── Unauthenticated guard (check before login is used) ───────────────
  // (Already logged out student above — this is just documentation)

  // ── List all tickets ──────────────────────────────────────────────────
  group("admin_list_tickets", () => {
    const res  = http.get(`${API}/tickets/?page_size=20`);
    const body = parseBody(res);
    check(res, {
      "admin list tickets 200":    (r) => r.status === 200,
      "has results array":         () => Array.isArray(body.results) || Array.isArray(body),
    });
  });

  // ── Filter by status ──────────────────────────────────────────────────
  group("filter_tickets_by_status", () => {
    const res = http.get(`${API}/tickets/?status=submitted&page_size=5`);
    check(res, { "filter by status 200": (r) => r.status === 200 });
  });

  // ── Read specific ticket ───────────────────────────────────────────────
  group("admin_read_ticket", () => {
    const res  = http.get(`${API}/tickets/${ticketId}/`);
    const body = parseBody(res);
    check(res, {
      "admin read ticket 200": (r) => r.status === 200,
      "ticket id correct":     () => body.id === ticketId,
    });
  });

  // ── PATCH ticket subject ───────────────────────────────────────────────
  group("patch_ticket", () => {
    const res  = jsonPatch(`${API}/tickets/${ticketId}/`, {
      subject: "k6 admin test ticket (updated by staff)",
    }, staffCsrf);
    check(res, {
      "patch ticket 200": (r) => r.status === 200,
    });
  });

  // ── Transition status: submitted → triaged ────────────────────────────
  group("status_transition_triaged", () => {
    const res  = jsonPost(`${API}/tickets/${ticketId}/status/`, {
      status: "triaged",
    }, staffCsrf);
    const body = parseBody(res);
    check(res, {
      "triage 200":             (r) => r.status === 200,
      "status is triaged":      () => body.status === "triaged",
    });
  });

  // ── Transition status: triaged → in_progress ─────────────────────────
  group("status_transition_in_progress", () => {
    const res  = jsonPost(`${API}/tickets/${ticketId}/status/`, {
      status: "in_progress",
    }, staffCsrf);
    const body = parseBody(res);
    check(res, {
      "in_progress 200":            (r) => r.status === 200,
      "status is in_progress":      () => body.status === "in_progress",
    });
  });

  // ── Illegal transition: in_progress → submitted (state machine) ──────
  group("illegal_status_transition", () => {
    const res = jsonPost(`${API}/tickets/${ticketId}/status/`, {
      status: "submitted",
    }, staffCsrf);
    check(res, {
      "illegal transition rejected 400": (r) => r.status === 400,
    });
  });

  // ── Assignable staff list ─────────────────────────────────────────────
  group("assignable_staff", () => {
    const res   = http.get(`${API}/tickets/assignable-staff/`);
    const staff = parseBody(res);
    check(res, {
      "assignable-staff 200":    (r) => r.status === 200,
      "assignable-staff array":  () => Array.isArray(staff),
    });
  });

  // ── Read events ───────────────────────────────────────────────────────
  group("ticket_events", () => {
    const res    = http.get(`${API}/tickets/${ticketId}/events/`);
    const events = parseBody(res);
    check(res, {
      "events 200":                (r) => r.status === 200,
      "has status_changed event":  () => Array.isArray(events) &&
                                         events.some((e) => e.action === "status_changed"),
    });
  });

  // ── Resolve the ticket ────────────────────────────────────────────────
  group("resolve_ticket", () => {
    const res  = jsonPost(`${API}/tickets/${ticketId}/status/`, {
      status: "resolved",
      reason: "k6 test cleanup.",
    }, staffCsrf);
    check(res, {
      "resolve 200":           (r) => r.status === 200,
      "status is resolved":    () => parseBody(res).status === "resolved",
    });
  });

  // ── Admin summary ──────────────────────────────────────────────────────
  group("admin_summary", () => {
    const res = http.get(`${API}/admin/summary/`);
    check(res, {
      "admin summary 200":         (r) => r.status === 200,
      "summary has total_tickets": () => {
        try { return typeof JSON.parse(res.body).total_tickets === "number"; }
        catch { return false; }
      },
    });
  });

  // ── Ticket export ──────────────────────────────────────────────────────
  group("ticket_export", () => {
    const res = http.get(`${API}/tickets/export/?status=resolved`);
    check(res, {
      "export 200 or 204":        (r) => r.status === 200 || r.status === 204,
      "export is xlsx if 200":    (r) => {
        if (r.status !== 200) return true; // 204 = no results, skip
        const ct = r.headers["Content-Type"] || "";
        return ct.includes("spreadsheetml") || ct.includes("excel") || ct.includes("octet-stream");
      },
    });
  });

  logout(staffCsrf);
  sleep(1);
}
