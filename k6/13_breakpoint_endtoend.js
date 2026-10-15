/**
 * 13_breakpoint_endtoend.js
 * ──────────────────────────
 * Full end-to-end breakpoint test: Browser → Cloudflare Tunnel → Next.js →
 * Django → SQLite.
 *
 * PURPOSE
 * ───────
 * Uses the PUBLIC domain (ithelpdesk-iic.cloud-dev.tech) so the test
 * travels the exact same path a real user does: through Cloudflare Tunnel,
 * through Next.js, through Gunicorn/Django.
 *
 * This is the most important breakpoint test — it finds the real capacity
 * limit of the full stack as a user would experience it, including:
 *   - Cloudflare Tunnel throughput ceiling
 *   - Next.js Node.js event loop saturation
 *   - Gunicorn gthread worker exhaustion
 *   - SQLite write-lock contention under concurrent writes
 *
 * STAGES — 15-minute ramp, same as other breakpoint tests
 * ──────────────────────────────────────────────────────────
 *  1 → 10 → 25 → 50 → 100 → 150 → 200 → 300 VUs then cool-down.
 * At each plateau, check the console output for the VU count where
 * p99 crossed 1 s — that is your breakpoint.
 *
 * IMPORTANT
 * ─────────
 * Run this test ONLY in a controlled window (not during business hours).
 * At 300 VUs against the production domain it WILL stress the live server.
 * Start with E2E_MAX_VUS=50 for your first run to verify things work,
 * then increase.
 *
 * Environment variables:
 *   E2E_URL          Public frontend URL  (default: https://ithelpdesk-iic.cloud-dev.tech)
 *   E2E_MAX_VUS      Max VU count         (default: 300 — reduce for safety)
 *   STUDENT_EMAIL, STUDENT_PASSWORD, TEST_CATEGORY_SLUG
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";
import { parseBody } from "./helpers.js";

const E2E_URL  = __ENV.E2E_URL     || "https://ithelpdesk-iic.cloud-dev.tech";
const MAX_VUS  = parseInt(__ENV.E2E_MAX_VUS || "300", 10);
const API      = `${E2E_URL}/api/v1`;

const EMAIL    = __ENV.STUDENT_EMAIL    || "student@iic.edu.np";
const PASSWORD = __ENV.STUDENT_PASSWORD || "TestPassword123!";
const SLUG     = __ENV.TEST_CATEGORY_SLUG || "general-support";

// ── Custom metrics ────────────────────────────────────────────────────────────
const e2eRead  = new Trend("e2e_read_latency",  true);
const e2eWrite = new Trend("e2e_write_latency", true);
const e2ePage  = new Trend("e2e_page_latency",  true);
const errors   = new Counter("e2e_errors");
const errRate  = new Rate("e2e_error_rate");

// ── Dynamic stages using MAX_VUS ──────────────────────────────────────────────
export const options = {
  stages: [
    { duration: "30s", target: Math.min(10,  MAX_VUS) },
    { duration: "30s", target: Math.min(25,  MAX_VUS) },
    { duration: "30s", target: Math.min(50,  MAX_VUS) },
    { duration: "60s", target: Math.min(50,  MAX_VUS) },
    { duration: "30s", target: Math.min(100, MAX_VUS) },
    { duration: "60s", target: Math.min(100, MAX_VUS) },
    { duration: "30s", target: Math.min(150, MAX_VUS) },
    { duration: "60s", target: Math.min(150, MAX_VUS) },
    { duration: "30s", target: Math.min(200, MAX_VUS) },
    { duration: "60s", target: Math.min(200, MAX_VUS) },
    { duration: "60s", target: MAX_VUS },
    { duration: "60s", target: MAX_VUS },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    // Full-stack SLOs — include Cloudflare + Next.js proxy overhead
    "http_req_duration": [
      { threshold: "p(95)<1000", abortOnFail: false },
      { threshold: "p(99)<2000", abortOnFail: false },  // 2 s p99 for full stack
    ],
    "http_req_failed":   [{ threshold: "rate<0.02",  abortOnFail: false }],
    "e2e_read_latency":  [{ threshold: "p(99)<2000", abortOnFail: false }],
    "e2e_write_latency": [{ threshold: "p(99)<3000", abortOnFail: false }],
    "e2e_page_latency":  [{ threshold: "p(99)<2000", abortOnFail: false }],
    "e2e_error_rate":    [{ threshold: "rate<0.05",  abortOnFail: false }],
  },
};

// ── Setup ─────────────────────────────────────────────────────────────────────
export function setup() {
  console.log(`E2E breakpoint test targeting: ${E2E_URL} (max VUs: ${MAX_VUS})`);
  const cats = parseBody(http.get(`${API}/services/`));
  const cat  = Array.isArray(cats) ? cats.find((c) => c.slug === SLUG) : null;
  return { categoryId: cat ? cat.id : null };
}

// ── Per-VU work ───────────────────────────────────────────────────────────────
export default function (data) {
  const roll = (__VU + __ITER) % 10;

  if (roll < 3) {
    runE2EPageLoad();
  } else if (roll < 7) {
    runE2EApiReads();
  } else {
    if (data.categoryId) runE2EWritePath(data.categoryId);
    else runE2EApiReads();
  }

  sleep(0.3); // slightly longer think time — real users are slower
}

// ── Scenario 1: Public page load via Cloudflare → Next.js ────────────────────
function runE2EPageLoad() {
  const pages = ["/", "/services", "/help", "/status"];
  const page  = pages[__ITER % pages.length];

  const t0  = Date.now();
  const res = http.get(`${E2E_URL}${page}`, {
    headers: { "Accept": "text/html" },
  });
  e2ePage.add(Date.now() - t0);

  const ok = res.status === 200 || res.status === 307 || res.status === 302;
  errRate.add(!ok);
  if (!ok) errors.add(1);

  check(res, {
    "E2E page load ok": (r) => r.status === 200 || r.status === 307 || r.status === 302,
  });
}

// ── Scenario 2: API reads via Cloudflare → Next.js → Django ──────────────────
function runE2EApiReads() {
  const t0 = Date.now();

  const r1 = http.get(`${API}/health/`);
  const r2 = http.get(`${API}/services/`);
  const r3 = http.get(`${API}/guides/`);

  e2eRead.add(Date.now() - t0);

  const ok = r1.status === 200 && r2.status === 200;
  errRate.add(!ok);
  if (!ok) errors.add(1);

  check(r1, { "E2E health 200":   (r) => r.status === 200 });
  check(r2, { "E2E services 200": (r) => r.status === 200 });
  check(r3, { "E2E guides 200":   (r) => r.status === 200 });
}

// ── Scenario 3: Full write path Cloudflare → Next.js → Django → SQLite ────────
function runE2EWritePath(categoryId) {
  // CSRF + login through the full public stack
  const csrfRes = http.get(`${API}/auth/csrf/`);
  const jar     = http.cookieJar();
  const c1      = jar.cookiesForURL(E2E_URL);
  const csrf    = (c1.csrftoken && c1.csrftoken[0]) || "";

  if (!csrf) { errors.add(1); errRate.add(true); return; }

  const loginRes = http.post(`${API}/auth/login/`,
    JSON.stringify({ identifier: EMAIL, password: PASSWORD }),
    { headers: { "Content-Type": "application/json", "X-CSRFToken": csrf } }
  );

  if (loginRes.status !== 200) {
    errors.add(1); errRate.add(true); return;
  }

  const c2    = jar.cookiesForURL(E2E_URL);
  const csrf2 = (c2.csrftoken && c2.csrftoken[0]) || csrf;

  // Create ticket
  const t0     = Date.now();
  const create = http.post(`${API}/tickets/`,
    JSON.stringify({
      category:    categoryId,
      subject:     `E2E BP VU${__VU} i${__ITER}`,
      description: "Full-stack breakpoint test ticket — auto-cancelled.",
    }),
    { headers: { "Content-Type": "application/json", "X-CSRFToken": csrf2 } }
  );
  e2eWrite.add(Date.now() - t0);

  const ok = create.status === 201;
  errRate.add(!ok);
  if (!ok) { errors.add(1); }

  check(create, { "E2E create ticket 201": (r) => r.status === 201 });

  if (ok) {
    const id = parseBody(create).id;
    if (id) {
      // Read the ticket back
      const read = http.get(`${API}/tickets/${id}/`);
      check(read, { "E2E read ticket 200": (r) => r.status === 200 });

      // Send a message
      http.post(`${API}/tickets/${id}/messages/`,
        JSON.stringify({ body: `E2E load test message VU${__VU}` }),
        { headers: { "Content-Type": "application/json", "X-CSRFToken": csrf2 } }
      );

      // Cancel cleanup
      http.post(`${API}/tickets/${id}/status/`,
        JSON.stringify({ status: "cancelled", reason: "e2e bp test cleanup" }),
        { headers: { "Content-Type": "application/json", "X-CSRFToken": csrf2 } }
      );
    }
  }

  // Logout
  http.post(`${API}/auth/logout/`, null,
    { headers: { "X-CSRFToken": csrf2 } }
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────
export function handleSummary(data) {
  const m   = data.metrics;
  const pct = (key, p) => (m[key]?.values[p] ?? 0).toFixed(1);
  const rt  = (key)     => ((m[key]?.values?.rate ?? 0) * 100).toFixed(2);

  const p95 = parseFloat(pct("http_req_duration", "p(95)"));
  const p99 = parseFloat(pct("http_req_duration", "p(99)"));
  const err = parseFloat(rt("http_req_failed"));

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║      END-TO-END BREAKPOINT TEST — FINAL REPORT              ║
║      Target: ${E2E_URL.padEnd(47)}║
╠══════════════════════════════════════════════════════════════╣
║  Full-stack http_req_duration                                ║
║    p(50) : ${pct("http_req_duration","p(50)").padEnd(8)} ms                               ║
║    p(95) : ${pct("http_req_duration","p(95)").padEnd(8)} ms  SLO < 1000 ms  ${p95<1000?"✓ PASS":"✗ FAIL"}     ║
║    p(99) : ${pct("http_req_duration","p(99)").padEnd(8)} ms  SLO < 2000 ms  ${p99<2000?"✓ PASS":"✗ FAIL"} ★   ║
║    max   : ${pct("http_req_duration","max").padEnd(8)} ms                               ║
╠══════════════════════════════════════════════════════════════╣
║  Page load  p(99): ${pct("e2e_page_latency","p(99)").padEnd(7)} ms                         ║
║  Read API   p(99): ${pct("e2e_read_latency","p(99)").padEnd(7)} ms                         ║
║  Write path p(99): ${pct("e2e_write_latency","p(99)").padEnd(7)} ms                         ║
╠══════════════════════════════════════════════════════════════╣
║  Error rate  : ${rt("http_req_failed").padEnd(7)} %  SLO < 2 %   ${err<2?"✓ PASS":"✗ FAIL"}          ║
║  E2E errors  : ${String(m["e2e_errors"]?.values?.count ?? 0).padEnd(7)}                                  ║
║  Total reqs  : ${String(m["http_reqs"]?.values?.count ?? 0).padEnd(7)}                                  ║
║  Max VUs     : ${String(MAX_VUS).padEnd(7)}                                  ║
╠══════════════════════════════════════════════════════════════╣
║  BREAKPOINT: The VU stage where p99 first exceeded 2000 ms   ║
║  or error rate spiked is the system capacity limit.          ║
║  Run with --out csv=results.csv to capture per-second data   ║
║  and plot p99 vs VU count to find the exact breakpoint.      ║
╚══════════════════════════════════════════════════════════════╝
`);
  return {};
}
