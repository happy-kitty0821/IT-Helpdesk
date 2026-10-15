/**
 * 11_breakpoint_backend.js
 * ─────────────────────────
 * Backend (Django/Gunicorn) breakpoint test.
 *
 * PURPOSE
 * ───────
 * Gradually increases concurrent users from 1 to 300 over 10 minutes,
 * holding each step long enough to get stable p95/p99 readings.
 * The test does NOT stop when thresholds are breached — it runs to
 * completion so you can see the exact VU count where the system degraded.
 * Thresholds are set to "abortOnFail: false" for the same reason.
 *
 * After the run, check the console summary to see:
 *   - The p95 and p99 at each stage
 *   - The VU count where error rate first spiked
 *   - The VU count where p99 first exceeded 1 s
 *
 * STAGES
 * ──────
 *    1 →  10 VUs  over  30 s
 *   10 →  25 VUs  over  30 s
 *   25 →  50 VUs  over  30 s
 *   50 VUs         for  60 s  (first sustained plateau)
 *   50 → 100 VUs  over  30 s
 *  100 VUs         for  60 s
 *  100 → 150 VUs  over  30 s
 *  150 VUs         for  60 s
 *  150 → 200 VUs  over  30 s
 *  200 VUs         for  60 s
 *  200 → 300 VUs  over  60 s
 *  300 VUs         for  60 s  (max — likely past breakpoint by here)
 *    0             over  30 s
 *
 * WORKLOAD MIX (realistic, not write-heavy)
 * ──────────────────────────────────────────
 *   50 % — authenticated reads  (list tickets, /me/)
 *   30 % — public reads         (services, health, guides)
 *   20 % — writes               (create + cancel ticket)
 *
 * Environment variables:
 *   BACKEND_URL       Direct Django URL  (default: http://127.0.0.1:8000)
 *   STUDENT_EMAIL, STUDENT_PASSWORD
 *   TEST_CATEGORY_SLUG
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";
import { login, logout, jsonPost, parseBody } from "./helpers.js";

const BACKEND  = __ENV.BACKEND_URL || __ENV.BASE_URL || "http://127.0.0.1:8000";
const API      = `${BACKEND}/api/v1`;

const EMAIL    = __ENV.STUDENT_EMAIL    || "student@iic.edu.np";
const PASSWORD = __ENV.STUDENT_PASSWORD || "TestPassword123!";
const SLUG     = __ENV.TEST_CATEGORY_SLUG || "general-support";

// ── Custom metrics ────────────────────────────────────────────────────────────
const latencyRead  = new Trend("bp_read_latency",  true);
const latencyWrite = new Trend("bp_write_latency", true);
const errors       = new Counter("bp_errors");
const errorRate    = new Rate("bp_error_rate");

// ── Stages ────────────────────────────────────────────────────────────────────
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
  // abortOnFail: false so the test runs to completion even if thresholds breach
  thresholds: {
    "http_req_duration":   [
      { threshold: "p(95)<500",  abortOnFail: false },
      { threshold: "p(99)<1000", abortOnFail: false },
    ],
    "http_req_failed":     [{ threshold: "rate<0.01", abortOnFail: false }],
    "bp_read_latency":     [{ threshold: "p(99)<1000", abortOnFail: false }],
    "bp_write_latency":    [{ threshold: "p(99)<1500", abortOnFail: false }],
    "bp_error_rate":       [{ threshold: "rate<0.05",  abortOnFail: false }],
  },
};

// ── Resolve category once ─────────────────────────────────────────────────────
export function setup() {
  const cats = parseBody(http.get(`${API}/services/`));
  const cat  = Array.isArray(cats) ? cats.find((c) => c.slug === SLUG) : null;
  return { categoryId: cat ? cat.id : null };
}

// ── VU workload ───────────────────────────────────────────────────────────────
export default function (data) {
  const roll = (__VU + __ITER) % 10;

  if (roll < 3) {
    // 30 % — public reads (no auth, very cheap)
    runPublicReads();
  } else if (roll < 8) {
    // 50 % — authenticated reads
    runAuthReads();
  } else {
    // 20 % — full write path
    if (data.categoryId) runWrites(data.categoryId);
    else runAuthReads();
  }

  sleep(0.2); // ~200 ms think time between iterations
}

function runPublicReads() {
  const t0 = Date.now();

  const r1 = http.get(`${API}/health/`);
  const r2 = http.get(`${API}/services/`);
  const r3 = http.get(`${API}/guides/`);

  const ok = r1.status === 200 && r2.status === 200 && r3.status === 200;
  latencyRead.add(Date.now() - t0);
  errorRate.add(!ok);
  if (!ok) errors.add(1);

  check(r1, { "BE health 200": (r) => r.status === 200 });
  check(r2, { "BE services 200": (r) => r.status === 200 });
}

function runAuthReads() {
  let csrf;
  try { csrf = login(EMAIL, PASSWORD); }
  catch { errors.add(1); errorRate.add(true); return; }

  const t0 = Date.now();
  const r1 = http.get(`${API}/auth/me/`);
  const r2 = http.get(`${API}/tickets/?page_size=10`);
  latencyRead.add(Date.now() - t0);

  const ok = r1.status === 200 && r2.status === 200;
  errorRate.add(!ok);
  if (!ok) errors.add(1);

  check(r1, { "BE me 200": (r) => r.status === 200 });
  check(r2, { "BE tickets 200": (r) => r.status === 200 });

  logout(csrf);
}

function runWrites(categoryId) {
  let csrf;
  try { csrf = login(EMAIL, PASSWORD); }
  catch { errors.add(1); errorRate.add(true); return; }

  const t0  = Date.now();
  const res = jsonPost(`${API}/tickets/`, {
    category:    categoryId,
    subject:     `BP test VU${__VU} i${__ITER}`,
    description: "Breakpoint test ticket — auto-cancelled.",
  }, csrf);
  latencyWrite.add(Date.now() - t0);

  const ok = res.status === 201;
  errorRate.add(!ok);
  if (!ok) { errors.add(1); }

  check(res, { "BE create 201": (r) => r.status === 201 });

  if (ok) {
    const id = parseBody(res).id;
    if (id) {
      jsonPost(`${API}/tickets/${id}/status/`, {
        status: "cancelled", reason: "bp test cleanup",
      }, csrf);
    }
  }

  logout(csrf);
}

// ── Summary ───────────────────────────────────────────────────────────────────
export function handleSummary(data) {
  const m   = data.metrics;
  const pct = (key, p) => (m[key]?.values[p] ?? 0).toFixed(1);
  const cnt = (key)     => m[key]?.values?.count ?? 0;
  const rt  = (key)     => ((m[key]?.values?.rate ?? 0) * 100).toFixed(2);

  const p95  = parseFloat(pct("http_req_duration", "p(95)"));
  const p99  = parseFloat(pct("http_req_duration", "p(99)"));
  const err  = parseFloat(rt("http_req_failed"));

  const slo95 = p95  < 500  ? "✓ PASS" : "✗ FAIL";
  const slo99 = p99  < 1000 ? "✓ PASS" : "✗ FAIL";
  const sloE  = err  < 1.0  ? "✓ PASS" : "✗ FAIL";

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║         BACKEND BREAKPOINT TEST — FINAL REPORT              ║
╠══════════════════════════════════════════════════════════════╣
║  http_req_duration                                           ║
║    p(50) : ${pct("http_req_duration","p(50)").padEnd(8)} ms                               ║
║    p(95) : ${pct("http_req_duration","p(95)").padEnd(8)} ms  SLO < 500 ms   ${slo95}      ║
║    p(99) : ${pct("http_req_duration","p(99)").padEnd(8)} ms  SLO < 1000 ms  ${slo99} ★    ║
║    max   : ${pct("http_req_duration","max").padEnd(8)} ms                               ║
╠══════════════════════════════════════════════════════════════╣
║  Read latency  p(95): ${pct("bp_read_latency","p(95)").padEnd(7)} ms  p(99): ${pct("bp_read_latency","p(99)")} ms   ║
║  Write latency p(95): ${pct("bp_write_latency","p(95)").padEnd(7)} ms  p(99): ${pct("bp_write_latency","p(99)")} ms   ║
╠══════════════════════════════════════════════════════════════╣
║  Error rate   : ${rt("http_req_failed").padEnd(7)} %   SLO < 1 %    ${sloE}         ║
║  Total errors : ${String(cnt("bp_errors")).padEnd(7)}                                  ║
║  Total reqs   : ${String(m["http_reqs"]?.values?.count ?? 0).padEnd(7)}                                  ║
╠══════════════════════════════════════════════════════════════╣
║  Max VUs reached: 300                                        ║
║  Breakpoint:  Check grafana/stdout for the VU count where    ║
║               p99 first crossed 1000 ms or errors spiked.   ║
╚══════════════════════════════════════════════════════════════╝
`);
  return {};
}
