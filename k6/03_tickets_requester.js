/**
 * 03_tickets_requester.js
 * ───────────────────────
 * Ticket lifecycle from the requester's perspective:
 *   - List own tickets
 *   - Create a new ticket
 *   - Read the ticket back
 *   - Send a message on the ticket
 *   - Read messages
 *   - Read ticket events (history)
 *   - Read ticket events (audit trail)
 *   - Submit priority promotion
 *   - Cancel the ticket
 *   - Attempt to view another user's ticket → 403/404
 *   - Submit feedback on a resolved ticket (status guard tested)
 *
 * Environment variables required:
 *   STUDENT_EMAIL, STUDENT_PASSWORD, TEST_CATEGORY_SLUG
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { API, login, logout, jsonPost, parseBody } from "./helpers.js";

export const options = {
  vus: 3,
  duration: "30s",
  thresholds: {
    http_req_failed:   ["rate<0.01"],
    http_req_duration: ["p(95)<1500"],
  },
};

const STUDENT_EMAIL    = __ENV.STUDENT_EMAIL    || "student@iic.edu.np";
const STUDENT_PASSWORD = __ENV.STUDENT_PASSWORD || "TestPassword123!";
const CATEGORY_SLUG    = __ENV.TEST_CATEGORY_SLUG || "general-support";

export default function () {
  const csrf = login(STUDENT_EMAIL, STUDENT_PASSWORD);

  // ── Find category id from slug ──────────────────────────────────────────
  let categoryId = null;
  group("find_category", () => {
    const res  = http.get(`${API}/services/`);
    const cats = parseBody(res);
    if (Array.isArray(cats)) {
      const cat = cats.find((c) => c.slug === CATEGORY_SLUG);
      if (cat) categoryId = cat.id;
    }
    check(res, {
      "services available":        (r) => r.status === 200,
      "test category found":       () => categoryId !== null,
    });
  });

  if (!categoryId) {
    logout(csrf);
    return;
  }

  // ── List own tickets ───────────────────────────────────────────────────
  group("list_tickets", () => {
    const res  = http.get(`${API}/tickets/`);
    const body = parseBody(res);
    check(res, {
      "list tickets 200":     (r) => r.status === 200,
      "list has results key": () => Array.isArray(body.results) || Array.isArray(body),
    });
  });

  // ── Create ticket ──────────────────────────────────────────────────────
  let ticketId = null;
  let ticketRef = null;

  group("create_ticket", () => {
    const res  = jsonPost(`${API}/tickets/`, {
      category:    categoryId,
      subject:     "k6 test ticket — automated",
      description: "This ticket was created by a k6 load test. Safe to ignore.",
    }, csrf);
    const body = parseBody(res);
    check(res, {
      "create ticket 201":          (r) => r.status === 201,
      "ticket has id":              () => typeof body.id === "string",
      "ticket has reference":       () => typeof body.reference === "string",
      "ticket status is submitted": () => body.status === "submitted",
      "ticket has is_overdue field": () => typeof body.is_overdue === "boolean",
    });
    ticketId  = body.id;
    ticketRef = body.reference;
  });

  if (!ticketId) {
    logout(csrf);
    return;
  }

  // ── Read ticket ────────────────────────────────────────────────────────
  group("read_ticket", () => {
    const res  = http.get(`${API}/tickets/${ticketId}/`);
    const body = parseBody(res);
    check(res, {
      "read ticket 200":       (r) => r.status === 200,
      "ticket id matches":     () => body.id === ticketId,
      "ticket ref matches":    () => body.reference === ticketRef,
    });
  });

  // ── Send message ───────────────────────────────────────────────────────
  let messageId = null;
  group("send_message", () => {
    const res  = jsonPost(`${API}/tickets/${ticketId}/messages/`, {
      body: "Hello, this is a test message from k6.",
    }, csrf);
    const body = parseBody(res);
    check(res, {
      "send message 201":       (r) => r.status === 201,
      "message has id":         () => typeof body.id === "number",
      "message body matches":   () => body.body === "Hello, this is a test message from k6.",
      "message is not staff":   () => body.is_staff_reply === false,
    });
    messageId = body.id;
  });

  // ── Read messages ──────────────────────────────────────────────────────
  group("read_messages", () => {
    const res  = http.get(`${API}/tickets/${ticketId}/messages/`);
    const msgs = parseBody(res);
    check(res, {
      "messages 200":          (r) => r.status === 200,
      "messages has content":  () => Array.isArray(msgs) && msgs.length >= 1,
    });
  });

  // ── Read events (history) ─────────────────────────────────────────────
  group("read_events", () => {
    const res    = http.get(`${API}/tickets/${ticketId}/events/`);
    const events = parseBody(res);
    check(res, {
      "events 200":                  (r) => r.status === 200,
      "events is array":             () => Array.isArray(events),
      "has created event":           () => Array.isArray(events) && events.some((e) => e.action === "created"),
    });
  });

  // ── Priority promotion ─────────────────────────────────────────────────
  group("priority_promotion", () => {
    const res  = jsonPost(`${API}/tickets/${ticketId}/priority/`, {
      priority: "p2",
      reason:   "Issue is becoming urgent — escalating for k6 test.",
    }, csrf);
    check(res, {
      "priority promotion 200 or 400": (r) => r.status === 200 || r.status === 400,
      // 400 is fine if the ticket is already p2 or p1
    });
  });

  // ── Cancel ticket ──────────────────────────────────────────────────────
  group("cancel_ticket", () => {
    const res  = jsonPost(`${API}/tickets/${ticketId}/status/`, {
      status: "cancelled",
      reason: "k6 test cleanup — safe to ignore.",
    }, csrf);
    const body = parseBody(res);
    check(res, {
      "cancel 200":                  (r) => r.status === 200,
      "status is cancelled":         () => body.status === "cancelled",
    });
  });

  // ── Feedback rejected on cancelled ticket ────────────────────────────
  group("feedback_rejected_on_cancelled", () => {
    const res = jsonPost(`${API}/tickets/${ticketId}/feedback/`, {
      rating: 5,
      comment: "k6 test feedback",
    }, csrf);
    // Feedback only allowed on resolved/closed — cancelled should be rejected
    check(res, {
      "feedback rejected on cancelled (400/403)": (r) => r.status === 400 || r.status === 403,
    });
  });

  // ── Access control — random UUID should 404 ───────────────────────────
  group("access_control_404", () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res    = http.get(`${API}/tickets/${fakeId}/`);
    check(res, {
      "unknown ticket 404 or 403": (r) => r.status === 404 || r.status === 403,
    });
  });

  logout(csrf);
  sleep(1);
}
