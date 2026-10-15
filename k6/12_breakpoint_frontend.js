/**
 * 12_breakpoint_frontend.js
 * ──────────────────────────
 * Frontend (Next.js on port 3000) breakpoint test.
 *
 * PURPOSE
 * ───────
 * Same ramping strategy as the backend test but targeting Next.js directly.
 * Tests the complete frontend stack: static page responses, the Next.js
 * API proxy layer, the SSE Route Handler, and the full
 * browser → Next.js → Django chain.
 *
 * This tells you:
 *   - Whether Next.js itself becomes the bottleneck before Django does
 *   - Whether the SSE Route Handler holds up under concurrent connections
 *   - Where the Node.js process (Next.js) saturates CPU/memory
 *
 * WORKLOAD MIX
 * ────────────
 *   40 % — Public Next.js pages (home, /tickets, /services, /help)
 *   30 % — API calls proxied through Next.js to Django
 *   20 % — Full auth flow through Next.js proxy
 *   10 % — SSE stream connect (short read to verify first event arrives)
 *
 * STAGES
 * ──────
 * Same 13-stage ramp as backend test (1 → 300 VUs over ~10 min).
 *
 * Environment variables:
 *   FRONTEND_URL      Next.js public URL  (default: http://127.0.0.1:3000)
 *   BASE_URL          Django URL          (default: http://127.0.0.1:8000)
 *   STUDENT_EMAIL, STUDENT_PASSWORD, TEST_CATEGORY_SLUG
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";
import { parseBody } from "./helpers.js";

const FRONTEND = __ENV.FRONTEND_URL || "http://127.0.0.1:3000";
const BACKEND  = __ENV.BASE_URL     || "http://127.0.0.1:8000";

// Next.js proxies /api/v1/* to Django — use FRONTEND for all API calls
// so we're testing the full proxy chain, not bypassing Next.js.
const FAPI = `${FRONTEND}/api/v1`;

const EMAIL    = __ENV.STUDENT_EMAIL    || "student@iic.edu.np";
const PASSWORD = __ENV.STUDENT_PASSWORD || "TestPassword123!";
const SLUG     = __ENV.TEST_CATEGORY_SLUG || "general-support";

// ── Custom metrics ────────────────────────────────────────────────────────────
const pageLatency  = new Trend("fe_page_latency",  true);
const apiLatency   = new Trend("fe_api_latency",   true);
const sseLatency   = new Trend("fe_sse_latency",   true);
const errors       = new Counter("fe_errors");
const errorRate    = new Rate("fe_error_rate");

export const options = {
  stages: [
    { duration: "30s", target: 10  },
    { duration: "30s", target: 25  },
    { duration: "30s", target: 50  },
    { duration: "60s", target: 50  },
    { duration: "30s", target: 100 },
    { duration: "60s", target: 100 },
    { duration: "30s", target: 150 },
    { duration: "60s", target: 150 },
    { duration: "30s", target: 200 },
    { duration: "60s", target: 200 },
    { duration: "60s", target: 300 },
    { duration: "60s", target: 300 },
    { duration: "30s", target: 0   },
  ],
  thresholds: {
    // Frontend SLOs — slightly looser than backend because Next.js adds
    // a proxy hop on top of Django's latency.
    "http_req_duration": [
      { threshold: "p(95)<700",  abortOnFail: false },
      { threshold: "p(99)<1200", abortOnFail: false },
    ],
    "http_req_failed":   [{ threshold: "rate<0.01",  abortOnFail: false }],
    "fe_page_latency":   [{ threshold: "p(99)<1000", abortOnFail: false }],
    "fe_api_latency":    [{ threshold: "p(99)<1200", abortOnFail: false }],
    "fe_sse_latency":    [{ threshold: "p(99)<3000", abortOnFail: false }],
    "fe_error_rate":     [{ threshold: "rate<0.05",  abortOnFail: false }],
  },
};

// ── Setup: resolve category id ────────────────────────────────────────────────
export function setup() {
  const cats = parseBody(http.get(`${FAPI}/services/`));
  const cat  = Array.isArray(cats) ? cats.find((c) => c.slug === SLUG) : null;
  return { categoryId: cat ? cat.id : null };
}

// ── Per-VU work ───────────────────────────────────────────────────────────────
export default function (data) {
  const roll = (__VU + __ITER) % 10;

  if (roll < 4) {
    runPageLoads();
  } else if (roll < 7) {
    runApiThroughProxy();
  } else if (roll < 9) {
    runAuthThroughProxy();
  } else {
    runSseCheck(data.categoryId);
  }

  sleep(0.2);
}

// ── Scenario 1: Page loads (HTML responses from Next.js) ─────────────────────
function runPageLoads() {
  const pages = ["/", "/tickets", "/help", "/services", "/status", "/login"];
  const url   = `${FRONTEND}${pages[__ITER % pages.length]}`;

  const t0  = Date.now();
  const res = http.get(url, {
    headers: { "Accept": "text/html,application/xhtml+xml" },
  });
  pageLatency.add(Date.now() - t0);

  // Next.js pages return 200 (or redirect to /login for protected pages)
  const ok = res.status === 200 || res.status === 307 || res.status === 302;
  errorRate.add(!ok);
  if (!ok) errors.add(1);

  check(res, {
    "FE page load ok (200/3xx)": (r) =>
      r.status === 200 || r.status === 307 || r.status === 302,
    "FE page has html content": (r) =>
      (r.headers["Content-Type"] || "").includes("text/html") ||
      r.status === 307 || r.status === 302,
  });
}

// ── Scenario 2: API calls through Next.js proxy ───────────────────────────────
function runApiThroughProxy() {
  const t0 = Date.now();

  const r1 = http.get(`${FAPI}/health/`);
  const r2 = http.get(`${FAPI}/services/`);
  const r3 = http.get(`${FAPI}/guides/`);
  const r4 = http.get(`${FAPI}/status/`);

  apiLatency.add(Date.now() - t0);

  const ok = r1.status === 200 && r2.status === 200;
  errorRate.add(!ok);
  if (!ok) errors.add(1);

  check(r1, { "FE proxy health 200":   (r) => r.status === 200 });
  check(r2, { "FE proxy services 200": (r) => r.status === 200 });
  check(r3, { "FE proxy guides 200":   (r) => r.status === 200 });
  check(r4, { "FE proxy status 200":   (r) => r.status === 200 });
}

// ── Scenario 3: Full auth flow through Next.js proxy ─────────────────────────
function runAuthThroughProxy() {
  // Get CSRF through frontend proxy
  const csrfRes = http.get(`${FAPI}/auth/csrf/`);
  const jar     = http.cookieJar();
  const cookies = jar.cookiesForURL(FRONTEND);
  const csrf    = (cookies.csrftoken && cookies.csrftoken[0]) || "";

  const t0     = Date.now();
  const login  = http.post(`${FAPI}/auth/login/`,
    JSON.stringify({ identifier: EMAIL, password: PASSWORD }),
    {
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken":  csrf,
      },
    }
  );
  apiLatency.add(Date.now() - t0);

  const ok = login.status === 200;
  errorRate.add(!ok);
  if (!ok) { errors.add(1); return; }

  check(login, { "FE proxy login 200": (r) => r.status === 200 });

  // /me/ through proxy
  const newCsrf = (() => {
    const c = jar.cookiesForURL(FRONTEND);
    return (c.csrftoken && c.csrftoken[0]) || csrf;
  })();

  const me = http.get(`${FAPI}/auth/me/`);
  check(me, { "FE proxy me 200": (r) => r.status === 200 });

  // Ticket list through proxy
  const tl = http.get(`${FAPI}/tickets/?page_size=5`);
  check(tl, { "FE proxy ticket list 200": (r) => r.status === 200 });

  // Logout
  http.post(`${FAPI}/auth/logout/`, null, {
    headers: { "X-CSRFToken": newCsrf },
  });
}

// ── Scenario 4: SSE Route Handler connectivity ───────────────────────────────
function runSseCheck(categoryId) {
  if (!categoryId) { runApiThroughProxy(); return; }

  // First need a ticket — login and create one
  const csrfRes = http.get(`${FAPI}/auth/csrf/`);
  const jar     = http.cookieJar();
  const c1      = jar.cookiesForURL(FRONTEND);
  const csrf    = (c1.csrftoken && c1.csrftoken[0]) || "";

  const login = http.post(`${FAPI}/auth/login/`,
    JSON.stringify({ identifier: EMAIL, password: PASSWORD }),
    { headers: { "Content-Type": "application/json", "X-CSRFToken": csrf } }
  );

  if (login.status !== 200) { errors.add(1); errorRate.add(true); return; }

  const c2        = jar.cookiesForURL(FRONTEND);
  const csrf2     = (c2.csrftoken && c2.csrftoken[0]) || csrf;

  // Create ticket
  const ticket = http.post(`${FAPI}/tickets/`,
    JSON.stringify({
      category:    categoryId,
      subject:     `FE bp SSE test VU${__VU}`,
      description: "SSE breakpoint test — auto-cancelled.",
    }),
    { headers: { "Content-Type": "application/json", "X-CSRFToken": csrf2 } }
  );

  if (ticket.status !== 201) {
    errors.add(1); errorRate.add(true);
    // Logout and return
    http.post(`${FAPI}/auth/logout/`, null, { headers: { "X-CSRFToken": csrf2 } });
    return;
  }

  const ticketId = parseBody(ticket).id;

  // Hit the SSE Route Handler at the frontend URL — this tests the full
  // Next.js Route Handler path including the internal fetch to Django.
  const t0  = Date.now();
  const sse = http.get(`${FAPI}/tickets/${ticketId}/stream/`, {
    headers: { "Accept": "text/event-stream" },
    timeout: "8s",   // read first chunk only
  });
  sseLatency.add(Date.now() - t0);

  // status 0 = k6 timeout with data read (stream stayed open — correct)
  // status 200 = stream closed cleanly
  const sseOk = sse.status === 0 || sse.status === 200;
  errorRate.add(!sseOk);
  if (!sseOk) errors.add(1);

  check(sse, {
    "FE SSE Route Handler responds":     (r) => r.status === 0 || r.status === 200,
    "FE SSE content-type event-stream":  (r) =>
      (r.headers["Content-Type"] || "").includes("text/event-stream"),
    "FE SSE delivers connected event":   (r) =>
      r.body != null && r.body.includes("event: connected"),
  });

  // Cleanup
  http.post(`${FAPI}/tickets/${ticketId}/status/`,
    JSON.stringify({ status: "cancelled", reason: "fe bp test cleanup" }),
    { headers: { "Content-Type": "application/json", "X-CSRFToken": csrf2 } }
  );

  http.post(`${FAPI}/auth/logout/`, null, { headers: { "X-CSRFToken": csrf2 } });
}

// ── Final summary ─────────────────────────────────────────────────────────────
export function handleSummary(data) {
  const m   = data.metrics;
  const pct = (key, p) => (m[key]?.values[p] ?? 0).toFixed(1);
  const rt  = (key)     => ((m[key]?.values?.rate ?? 0) * 100).toFixed(2);

  const p95  = parseFloat(pct("http_req_duration", "p(95)"));
  const p99  = parseFloat(pct("http_req_duration", "p(99)"));
  const err  = parseFloat(rt("http_req_failed"));

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║        FRONTEND BREAKPOINT TEST — FINAL REPORT              ║
╠══════════════════════════════════════════════════════════════╣
║  http_req_duration (all requests through Next.js)            ║
║    p(50) : ${pct("http_req_duration","p(50)").padEnd(8)} ms                               ║
║    p(95) : ${pct("http_req_duration","p(95)").padEnd(8)} ms  SLO < 700 ms   ${p95<700?"✓ PASS":"✗ FAIL"}      ║
║    p(99) : ${pct("http_req_duration","p(99)").padEnd(8)} ms  SLO < 1200 ms  ${p99<1200?"✓ PASS":"✗ FAIL"} ★   ║
╠══════════════════════════════════════════════════════════════╣
║  Page load p(99) : ${pct("fe_page_latency","p(99)").padEnd(8)} ms                         ║
║  API proxy p(99) : ${pct("fe_api_latency","p(99)").padEnd(8)} ms                         ║
║  SSE Route p(99) : ${pct("fe_sse_latency","p(99)").padEnd(8)} ms                         ║
╠══════════════════════════════════════════════════════════════╣
║  Error rate  : ${rt("http_req_failed").padEnd(7)} %  SLO < 1 %   ${err<1?"✓ PASS":"✗ FAIL"}          ║
║  FE errors   : ${String(m["fe_errors"]?.values?.count ?? 0).padEnd(7)}                                  ║
║  Total reqs  : ${String(m["http_reqs"]?.values?.count ?? 0).padEnd(7)}                                  ║
╚══════════════════════════════════════════════════════════════╝
`);
  return {};
}
