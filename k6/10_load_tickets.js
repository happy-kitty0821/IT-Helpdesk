/**
 * 10_load_tickets.js
 * ───────────────────
 * Load test — sustained concurrent ticket submission and retrieval.
 *
 * Simulates 20 virtual users each:
 *   1. Logging in as the configured student
 *   2. Listing their tickets
 *   3. Creating a new ticket
 *   4. Reading the ticket back
 *   5. Sending a message
 *   6. Cancelling the ticket (cleanup)
 *   7. Logging out
 *
 * Thresholds enforce that:
 *   - 95th percentile response time stays under 2 s
 *   - Error rate stays below 1%
 *   - Ticket creation succeeds at ≥ 99% rate
 *
 * Environment variables required:
 *   STUDENT_EMAIL, STUDENT_PASSWORD, TEST_CATEGORY_SLUG
 *
 * NOTE: All created tickets are cancelled at the end of each iteration
 * to keep the test database clean. Do not run this against production.
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter } from "k6/metrics";
import { API, login, logout, jsonPost, parseBody } from "./helpers.js";

// Custom metrics
const ticketsCreated  = new Counter("tickets_created");
const ticketsFailed   = new Counter("tickets_failed");
const messagesSent    = new Counter("messages_sent");

export const options = {
  vus:      20,
  duration: "30s",
  thresholds: {
    http_req_failed:        ["rate<0.01"],
    http_req_duration:      ["p(95)<2000", "p(99)<4000"],
    tickets_created:        ["count>10"],   // at least 10 created in 30 s
    tickets_failed:         ["count<5"],    // fewer than 5 failures
  },
};

const STUDENT_EMAIL    = __ENV.STUDENT_EMAIL    || "student@iic.edu.np";
const STUDENT_PASSWORD = __ENV.STUDENT_PASSWORD || "TestPassword123!";
const CATEGORY_SLUG    = __ENV.TEST_CATEGORY_SLUG || "general-support";

export default function () {
  const csrf = login(STUDENT_EMAIL, STUDENT_PASSWORD);

  // Resolve category once per VU per iteration
  let categoryId = null;
  const cats = parseBody(http.get(`${API}/services/`));
  if (Array.isArray(cats)) {
    const cat = cats.find((c) => c.slug === CATEGORY_SLUG);
    if (cat) categoryId = cat.id;
  }

  if (!categoryId) {
    logout(csrf);
    return;
  }

  // ── List tickets ───────────────────────────────────────────────────────
  group("load_list_tickets", () => {
    const res = http.get(`${API}/tickets/?page_size=10`);
    check(res, { "list 200": (r) => r.status === 200 });
  });

  // ── Create ticket ──────────────────────────────────────────────────────
  let ticketId = null;
  group("load_create_ticket", () => {
    const res  = jsonPost(`${API}/tickets/`, {
      category:    categoryId,
      subject:     `k6 load test ticket — VU ${__VU} iter ${__ITER}`,
      description: "Load test ticket. This is safe to delete.",
    }, csrf);
    const body = parseBody(res);
    if (res.status === 201 && body.id) {
      ticketsCreated.add(1);
      ticketId = body.id;
    } else {
      ticketsFailed.add(1);
    }
    check(res, { "create 201": (r) => r.status === 201 });
  });

  if (!ticketId) {
    logout(csrf);
    return;
  }

  // ── Read ticket ────────────────────────────────────────────────────────
  group("load_read_ticket", () => {
    const res = http.get(`${API}/tickets/${ticketId}/`);
    check(res, { "read 200": (r) => r.status === 200 });
  });

  // ── Send message ───────────────────────────────────────────────────────
  group("load_send_message", () => {
    const res = jsonPost(`${API}/tickets/${ticketId}/messages/`, {
      body: `k6 load test message from VU ${__VU}`,
    }, csrf);
    if (res.status === 201) messagesSent.add(1);
    check(res, { "message 201": (r) => r.status === 201 });
  });

  // ── Cancel ticket (cleanup) ────────────────────────────────────────────
  group("load_cancel_ticket", () => {
    jsonPost(`${API}/tickets/${ticketId}/status/`, {
      status: "cancelled",
      reason: "k6 load test cleanup.",
    }, csrf);
    // Don't check — if it's already cancelled that's fine
  });

  logout(csrf);
  sleep(0.5);
}

export function handleSummary(data) {
  const created  = data.metrics.tickets_created?.values?.count ?? 0;
  const failed   = data.metrics.tickets_failed?.values?.count ?? 0;
  const p95      = data.metrics.http_req_duration?.values["p(95)"] ?? 0;
  const errRate  = data.metrics.http_req_failed?.values?.rate ?? 0;

  console.log(`\n── Load Test Summary ──────────────────────`);
  console.log(`  Tickets created:  ${created}`);
  console.log(`  Tickets failed:   ${failed}`);
  console.log(`  p(95) latency:    ${p95.toFixed(0)} ms`);
  console.log(`  Error rate:       ${(errRate * 100).toFixed(2)}%`);
  console.log(`───────────────────────────────────────────\n`);

  return {};
}
