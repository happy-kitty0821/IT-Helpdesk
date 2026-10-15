# IIC IT Helpdesk — k6 Test Suite

A comprehensive [k6](https://k6.io/) performance and functional test suite for
the IIC IT Helpdesk. Tests cover every API endpoint, authentication flows,
SSE streaming, admin operations, and three breakpoint tests that gradually
ramp concurrent users until the system fails its p99 / p95 SLOs — revealing
the exact capacity limit of the backend, frontend, and full stack.

---

## Architecture under test

```
Browser
  └─► Cloudflare Tunnel (ithelpdesk-iic.cloud-dev.tech)
        └─► Next.js  (port 3000)
              ├─► Static pages  (/, /tickets, /services …)
              ├─► API proxy     (/api/v1/* → Django)
              └─► SSE Route Handler (/api/v1/tickets/[id]/stream/)
                    └─► Django / Gunicorn (port 8000, gthread workers)
                          └─► SQLite (development) / PostgreSQL (production)
```

The three breakpoint tests target each layer separately:

| Test | Target | Finds |
|------|--------|-------|
| `11_breakpoint_backend.js`  | Port 8000 (Django direct) | Gunicorn / SQLite ceiling |
| `12_breakpoint_frontend.js` | Port 3000 (Next.js direct) | Node.js / proxy ceiling |
| `13_breakpoint_endtoend.js` | Public domain (full stack) | Real user capacity limit |

---

## Prerequisites

### Install k6

```bash
# Ubuntu / Debian
sudo gpg -k
sudo gpg --no-default-keyring \
  --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 \
  --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] \
  https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# macOS
brew install k6

# Windows (Chocolatey)
choco install k6
```

### Verify installation

```bash
k6 version
# k6 v0.54.x (...)
```

---

## Configuration

Copy the example env file and fill in real values:

```bash
cp k6/.env.example k6/.env
```

| Variable | Description | Default |
|----------|-------------|---------|
| `BASE_URL` | Django backend URL (no trailing slash) | `http://127.0.0.1:8000` |
| `BACKEND_URL` | Same as BASE_URL — used by breakpoint tests | `http://127.0.0.1:8000` |
| `FRONTEND_URL` | Next.js URL | `http://127.0.0.1:3000` |
| `E2E_URL` | Public frontend domain | `https://ithelpdesk-iic.cloud-dev.tech` |
| `E2E_MAX_VUS` | Max VUs for the e2e breakpoint test | `300` |
| `STUDENT_EMAIL` | A verified, active student account | — |
| `STUDENT_PASSWORD` | Password for the student account | — |
| `STAFF_EMAIL` | A staff account (it_agent or higher) | — |
| `STAFF_PASSWORD` | Password for the staff account | — |
| `ADMIN_EMAIL` | An administrator account | — |
| `ADMIN_PASSWORD` | Password for the admin account | — |
| `TEST_CATEGORY_SLUG` | Service category to submit test tickets against | `general-support` |

**Never hardcode credentials.** Pass them via `-e KEY=VALUE` or a `.env` file.

---

## Running functional tests

These tests verify correctness — all checks must pass at low VU counts.
Run them before breakpoint tests to confirm the environment is healthy.

```bash
# 1. Public endpoints — no auth needed, safe to run anywhere
k6 run k6/01_health_public.js

# 2. Authentication: login, logout, profile, forgot password
k6 run -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... k6/02_auth.js

# 3. Ticket lifecycle — requester side
k6 run -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... k6/03_tickets_requester.js

# 4. Ticket admin — staff operations, status machine, export
k6 run -e STAFF_EMAIL=... -e STAFF_PASSWORD=... \
       -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... \
       k6/04_tickets_admin.js

# 5. SSE stream — verifies connected event arrives within 8 s
k6 run -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... k6/05_sse_stream.js

# 6. Notification channels, templates, routing rules
k6 run -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... \
       -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... \
       k6/06_notifications.js

# 7. Admin user management: list, roles, suspend
k6 run -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... \
       -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... \
       k6/07_admin_users.js

# 8. Content: guides, software, announcements, service status
k6 run -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... k6/08_content.js

# 9. Rate limiting: repeated bad logins should trigger 429
#    Run against dev server only — not production
k6 run -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... k6/09_rate_limits.js

# 10. Sustained load: 20 VUs × 30 s, ticket submit + cancel cycle
k6 run -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... k6/10_load_tickets.js
```

### Run all functional tests at once

```bash
for f in k6/0*.js; do
  k6 run \
    -e STUDENT_EMAIL=student@iic.edu.np \
    -e STUDENT_PASSWORD=YourPw! \
    -e STAFF_EMAIL=staff@iic.edu.np \
    -e STAFF_PASSWORD=StaffPw! \
    -e ADMIN_EMAIL=admin@iic.edu.np \
    -e ADMIN_PASSWORD=AdminPw! \
    "$f"
done
```

---

## Running breakpoint tests

Breakpoint tests ramp VUs from 1 to 300 over ~10 minutes, holding at each
step to collect stable latency readings. They use `abortOnFail: false` so
the full degradation curve is captured even after the SLO is breached.

### SLO thresholds

| Layer | p95 SLO | p99 SLO | Error rate SLO |
|-------|---------|---------|----------------|
| Backend (Django direct) | < 500 ms | < **1 000 ms** | < 0.5 % |
| Frontend (Next.js proxy) | < 700 ms | < **1 200 ms** | < 1 % |
| End-to-end (full stack) | < 1 000 ms | < **2 000 ms** | < 2 % |

### 11 — Backend breakpoint (Django / Gunicorn)

```bash
k6 run \
  -e BACKEND_URL=http://127.0.0.1:8000 \
  -e STUDENT_EMAIL=... \
  -e STUDENT_PASSWORD=... \
  k6/11_breakpoint_backend.js
```

Targets Django directly — bypasses Next.js and Cloudflare. Reveals whether
Gunicorn worker saturation or SQLite write-lock contention is the bottleneck.

Workload mix per VU iteration:
- 30 % public reads (health, services, guides)
- 50 % authenticated reads (list tickets, /me/)
- 20 % write path (create + cancel ticket)

### 12 — Frontend breakpoint (Next.js)

```bash
k6 run \
  -e FRONTEND_URL=http://127.0.0.1:3000 \
  -e STUDENT_EMAIL=... \
  -e STUDENT_PASSWORD=... \
  k6/12_breakpoint_frontend.js
```

Targets Next.js directly — bypasses Cloudflare but goes through the Node.js
proxy layer. Reveals whether Node.js event loop saturation or the SSE Route
Handler becomes the bottleneck before Django.

Workload mix:
- 40 % HTML page loads (/, /services, /help, /status)
- 30 % API calls proxied through Next.js
- 20 % full auth flow through proxy
- 10 % SSE Route Handler connect (verifies first event arrives)

### 13 — End-to-end breakpoint (Cloudflare → Next.js → Django)

```bash
# Safe first run — capped at 50 VUs
k6 run \
  -e E2E_URL=https://ithelpdesk-iic.cloud-dev.tech \
  -e E2E_MAX_VUS=50 \
  -e STUDENT_EMAIL=... \
  -e STUDENT_PASSWORD=... \
  k6/13_breakpoint_endtoend.js

# Full run — ramps to 300 VUs
k6 run \
  -e E2E_URL=https://ithelpdesk-iic.cloud-dev.tech \
  -e E2E_MAX_VUS=300 \
  -e STUDENT_EMAIL=... \
  -e STUDENT_PASSWORD=... \
  k6/13_breakpoint_endtoend.js
```

The real user path. `E2E_MAX_VUS` controls the ceiling — start at 50 to verify
credentials and environment work, then increase. At 300 VUs this will stress
the production server; run during low-traffic hours only.

### Ramp profile (all three breakpoint tests)

```
VUs  │                                             ╔══════╗
300  │                                         ╔═══╣ peak ╠═══╗
200  │                                 ╔══════╣            ╚═══╗
150  │                         ╔══════╣                        │
100  │                 ╔══════╣                                  │
 50  │         ╔══════╣                                          │
 25  │     ╔══╣                                                  │
 10  │  ╔══╣                                                     │
  1  │╔═╣                                                        ▼
     └──────────────────────────────────────────────────────────►
                           Time (~10 min)
```

---

## Capturing and plotting results

### Export to CSV

```bash
k6 run --out csv=backend_results.csv k6/11_breakpoint_backend.js
```

### Plot p99 latency vs time in Python

```python
import pandas as pd
import matplotlib.pyplot as plt

df  = pd.read_csv("backend_results.csv")
dur = df[(df["metric_name"] == "http_req_duration") & (df["metric_value"].notna())]
dur["timestamp"] = pd.to_datetime(dur["timestamp"], unit="s")

p99 = dur.set_index("timestamp")["metric_value"].resample("10s").quantile(0.99)
p95 = dur.set_index("timestamp")["metric_value"].resample("10s").quantile(0.95)

plt.figure(figsize=(14, 5))
plt.plot(p99.index, p99.values, label="p99 latency (ms)")
plt.plot(p95.index, p95.values, label="p95 latency (ms)", linestyle="--")
plt.axhline(1000, color="red",    linestyle=":",  label="p99 SLO (1 000 ms)")
plt.axhline(500,  color="orange", linestyle=":",  label="p95 SLO (500 ms)")
plt.xlabel("Time")
plt.ylabel("Latency (ms)")
plt.title("Backend breakpoint — p95 / p99 latency under increasing load")
plt.legend()
plt.tight_layout()
plt.savefig("backend_breakpoint.png")
print("Saved backend_breakpoint.png")
```

The x-axis maps directly to the VU ramp stages — the point where the line
crosses the red SLO line is your **breakpoint** (the max concurrent users the
system can handle within acceptable latency).

### Export to k6 Cloud (optional)

```bash
k6 cloud k6/11_breakpoint_backend.js
```

Requires a k6 Cloud account. Provides interactive dashboards with per-stage
breakdowns automatically.

---

## Test files at a glance

### Functional tests

| # | File | VUs | Duration | What it verifies |
|---|------|-----|----------|-----------------|
| 1 | `01_health_public.js` | 5 | 20 s | Health, CSRF, public services, guides, software, announcement, site settings |
| 2 | `02_auth.js` | 1 | 3 iter | Login (valid + invalid), /me/, profile read/PATCH, forgot-password guard, logout |
| 3 | `03_tickets_requester.js` | 3 | 30 s | Create, read, message, events, priority promotion, cancel, feedback guard, access control |
| 4 | `04_tickets_admin.js` | 2 | 30 s | Staff list/patch/assign/transition tickets, state machine guard, events, export |
| 5 | `05_sse_stream.js` | 1 | 2 iter | SSE connected event arrives, content-type, auth guard, wrong-ticket guard, admin stream |
| 6 | `06_notifications.js` | 1 | 2 iter | Channels CRUD, templates + use_file_fallback, routing rules, logs, non-admin blocked |
| 7 | `07_admin_users.js` | 1 | 2 iter | List users, grant/revoke role, suspend/unsuspend, intern scope, role settings |
| 8 | `08_content.js` | 2 | 20 s | Public guides/software/status, admin announcements CRUD, ticket form settings |
| 9 | `09_rate_limits.js` | 1 | 1 iter | Repeated bad logins trigger 429, admin rate limit stats/rules/violations |
| 10 | `10_load_tickets.js` | 20 | 30 s | Sustained concurrent ticket submission + message + cancel |

### Breakpoint tests

| # | File | Max VUs | SLO p99 | What it stresses |
|---|------|---------|---------|------------------|
| 11 | `11_breakpoint_backend.js` | 300 | 1 000 ms | Django, Gunicorn workers, SQLite write locks |
| 12 | `12_breakpoint_frontend.js` | 300 | 1 200 ms | Next.js Node.js, API proxy, SSE Route Handler |
| 13 | `13_breakpoint_endtoend.js` | configurable | 2 000 ms | Cloudflare Tunnel + full stack — real user capacity |

---

## Interpreting results

### Console output

Every breakpoint test prints a box summary at the end:

```
╔══════════════════════════════════════════════════════════════╗
║         BACKEND BREAKPOINT TEST — FINAL REPORT              ║
╠══════════════════════════════════════════════════════════════╣
║  http_req_duration                                           ║
║    p(50) : 42.3     ms                                       ║
║    p(95) : 384.1    ms  SLO < 500 ms   ✓ PASS               ║
║    p(99) : 1247.8   ms  SLO < 1000 ms  ✗ FAIL ★             ║
╠══════════════════════════════════════════════════════════════╣
║  Error rate   : 0.82    %   SLO < 1 %    ✓ PASS             ║
╚══════════════════════════════════════════════════════════════╝
```

A `✗ FAIL` on p99 means the system breached the 1-second SLO at some point
during the ramp. Check the CSV output to find the exact VU stage where it
crossed the threshold.

### What to look for

| Symptom | Likely cause |
|---------|-------------|
| p99 spikes at 50–100 VUs on backend test | SQLite write-lock contention under concurrent writes |
| p99 spikes earlier on frontend than backend | Node.js event loop or proxy buffering saturated |
| Error rate spikes suddenly | Gunicorn worker queue full — increase `workers × threads` in `gunicorn.conf.py` |
| p99 flat then cliff-edge spike | Connection pool exhausted — add `keepAliveConnections` or move to PostgreSQL |
| E2E worse than frontend alone | Cloudflare Tunnel throughput ceiling |

---

## Adding your own tests

All test files import from `helpers.js` which provides:

```js
import { login, logout, jsonPost, jsonPatch, jsonDelete, getCsrf, parseBody, API, BASE_URL }
  from "./helpers.js";
```

Follow the existing file numbering (`14_*.js`, `15_*.js`, …) and add an entry
to this README.
