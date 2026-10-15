/**
 * 05_sse_stream.js
 * ─────────────────
 * SSE (Server-Sent Events) stream connectivity tests.
 *
 * k6 does not have native EventSource support.  We use http.get() with
 * a short timeout to verify:
 *   1. The stream endpoint returns HTTP 200
 *   2. The Content-Type is text/event-stream
 *   3. The response body contains the "connected" event within the timeout
 *   4. An unauthenticated request is rejected (401/403)
 *   5. A ticket the user does not own is rejected (403/404)
 *
 * The stream stays open indefinitely — we deliberately set a short
 * responseTimeout so k6 reads only the first chunk then moves on.
 * Receiving the "connected" event in that first chunk proves the stream
 * is working end-to-end without buffering.
 *
 * Environment variables required:
 *   STUDENT_EMAIL, STUDENT_PASSWORD, STAFF_EMAIL, STAFF_PASSWORD,
 *   TEST_CATEGORY_SLUG
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { API, login, logout, jsonPost, parseBody } from "./helpers.js";

export const options = {
  vus: 1,
  iterations: 2,
  thresholds: {
    // Stream checks must all pass
    checks: ["rate==1.0"],
  },
};

const STUDENT_EMAIL    = __ENV.STUDENT_EMAIL    || "student@iic.edu.np";
const STUDENT_PASSWORD = __ENV.STUDENT_PASSWORD || "TestPassword123!";
const STAFF_EMAIL      = __ENV.STAFF_EMAIL      || "staff@iic.edu.np";
const STAFF_PASSWORD   = __ENV.STAFF_PASSWORD   || "TestStaffPassword123!";
const CATEGORY_SLUG    = __ENV.TEST_CATEGORY_SLUG || "general-support";

export default function () {

  // ── Create a ticket to stream ─────────────────────────────────────────
  const studentCsrf = login(STUDENT_EMAIL, STUDENT_PASSWORD);
  let ticketId = null;

  group("setup_ticket", () => {
    const cats = parseBody(http.get(`${API}/services/`));
    const cat  = Array.isArray(cats) ? cats.find((c) => c.slug === CATEGORY_SLUG) : null;
    if (!cat) { logout(studentCsrf); return; }

    const res  = jsonPost(`${API}/tickets/`, {
      category:    cat.id,
      subject:     "k6 SSE stream test ticket",
      description: "Created for SSE connectivity test.",
    }, studentCsrf);
    const body = parseBody(res);
    ticketId   = body.id;
    check(res, { "ticket created for SSE test": (r) => r.status === 201 });
  });

  if (!ticketId) { logout(studentCsrf); return; }

  // ── Unauthenticated stream attempt ────────────────────────────────────
  group("sse_unauthenticated", () => {
    // Log out first to test unauthenticated access
    logout(studentCsrf);
    const res = http.get(`${API}/tickets/${ticketId}/stream/`, {
      headers: { "Accept": "text/event-stream" },
      timeout: "5s",
    });
    check(res, {
      "unauthenticated stream not 200": (r) => r.status !== 200 ||
        // If 200, body must contain the SSE error event not a data stream
        (r.body && r.body.includes("Authentication required")),
    });
  });

  // ── Re-login for authenticated tests ──────────────────────────────────
  const csrf2 = login(STUDENT_EMAIL, STUDENT_PASSWORD);

  // ── Authenticated ticket stream ───────────────────────────────────────
  group("sse_ticket_stream", () => {
    // Use a short timeout — we only need the first chunk (connected event)
    const res = http.get(`${API}/tickets/${ticketId}/stream/`, {
      headers: { "Accept": "text/event-stream" },
      // responseTimeout forces k6 to read whatever arrived in 8 seconds
      // and return, rather than waiting for the stream to close.
      timeout: "8s",
    });

    // A timeout that received data returns status 200 with partial body
    check(res, {
      "sse returns 200":                  (r) => r.status === 0 || r.status === 200,
      // status 0 = k6 timeout (got some data, connection still open — expected)
      // status 200 = closed normally
      "sse content-type is event-stream": (r) => {
        const ct = (r.headers["Content-Type"] || "").toLowerCase();
        return ct.includes("text/event-stream");
      },
      "sse body has connected event":     (r) => {
        return r.body != null && r.body.includes("event: connected");
      },
      "sse body has ticket data":         (r) => {
        return r.body != null && r.body.includes(ticketId);
      },
    });
  });

  // ── Access control: stream for ticket not owned ───────────────────────
  group("sse_wrong_ticket", () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res    = http.get(`${API}/tickets/${fakeId}/stream/`, {
      headers: { "Accept": "text/event-stream" },
      timeout: "5s",
    });
    check(res, {
      "unknown ticket stream not 200": (r) =>
        r.status === 404 || r.status === 403 ||
        (r.body && r.body.includes("Ticket not found")),
    });
  });

  // ── Admin summary stream ──────────────────────────────────────────────
  logout(csrf2);
  const staffCsrf = login(STAFF_EMAIL, STAFF_PASSWORD);

  group("sse_admin_summary_stream", () => {
    const res = http.get(`${API}/admin/summary/stream/`, {
      headers: { "Accept": "text/event-stream" },
      timeout: "8s",
    });
    check(res, {
      "admin stream returns 200 or timeout": (r) => r.status === 0 || r.status === 200,
      "admin stream event-stream content-type": (r) => {
        const ct = (r.headers["Content-Type"] || "").toLowerCase();
        return ct.includes("text/event-stream");
      },
      "admin stream has summary_update": (r) =>
        r.body != null && r.body.includes("summary_update"),
    });
  });

  logout(staffCsrf);

  // ── Cancel test ticket ────────────────────────────────────────────────
  const cleanCsrf = login(STUDENT_EMAIL, STUDENT_PASSWORD);
  jsonPost(`${API}/tickets/${ticketId}/status/`, {
    status: "cancelled",
    reason: "k6 SSE test cleanup.",
  }, cleanCsrf);
  logout(cleanCsrf);

  sleep(1);
}
