# IIC IT Helpdesk — k6 Test Suite

## Overview

This folder contains [k6](https://k6.io/) load and functional tests for the
IIC IT Helpdesk API (Django backend). Tests cover authentication, ticket
lifecycle, admin operations, notifications, SSE streams, rate limiting, and
more.

## Prerequisites

```bash
# Install k6 (Ubuntu/Debian)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# macOS
brew install k6

# Windows (Chocolatey)
choco install k6
```

## Configuration

Copy `.env.example` and fill in credentials:

```bash
cp k6/.env.example k6/.env
```

The tests read environment variables at runtime — never hardcode credentials.

## Running tests

```bash
# From the repo root

# 1. Health + public endpoints (no auth needed)
k6 run k6/01_health_public.js

# 2. Authentication flows
k6 run k6/02_auth.js

# 3. Ticket CRUD — requester perspective
k6 run k6/03_tickets_requester.js

# 4. Ticket admin operations (needs staff credentials)
k6 run k6/04_tickets_admin.js

# 5. SSE stream connectivity
k6 run k6/05_sse_stream.js

# 6. Notification channels & templates
k6 run k6/06_notifications.js

# 7. Admin — users, roles, suspend
k6 run k6/07_admin_users.js

# 8. Guides & software catalog
k6 run k6/08_content.js

# 9. Rate limiting behaviour
k6 run k6/09_rate_limits.js

# 10. Load test — sustained concurrent ticket submissions
k6 run k6/10_load_tickets.js

# ── Breakpoint tests (find the capacity limit) ──────────────────────────────

# 11. Backend (Django/Gunicorn) breakpoint — ramps 1→300 VUs over ~10 min
#     Finds where p99 > 1 s or error rate spikes on the API directly
k6 run -e BACKEND_URL=http://127.0.0.1:8000 k6/11_breakpoint_backend.js

# 12. Frontend (Next.js) breakpoint — same ramp targeting port 3000
#     Finds where Node.js or the Next.js proxy becomes the bottleneck
k6 run -e FRONTEND_URL=http://127.0.0.1:3000 k6/12_breakpoint_frontend.js

# 13. End-to-end breakpoint — ramps through Cloudflare → Next.js → Django
#     The real user path — finds the true system capacity limit
#     Start with E2E_MAX_VUS=50 first to verify, then increase
k6 run -e E2E_MAX_VUS=50 k6/13_breakpoint_endtoend.js
k6 run -e E2E_MAX_VUS=300 k6/13_breakpoint_endtoend.js

# Capture per-second CSV data for plotting breakpoint graphs
k6 run --out csv=results.csv k6/11_breakpoint_backend.js

# Run everything sequentially
for f in k6/*.js; do k6 run "$f"; done
```

Pass environment variables inline:

```bash
k6 run -e BASE_URL=http://127.0.0.1:8000 \
       -e STUDENT_EMAIL=student@iic.edu.np \
       -e STUDENT_PASSWORD=YourPassword123! \
       -e STAFF_EMAIL=staff@iic.edu.np \
       -e STAFF_PASSWORD=YourStaffPw! \
       k6/02_auth.js
```

## Test files

| File | What it covers |
|------|----------------|
| `01_health_public.js`       | Health check, CSRF, public services, guides, software, announcement, site settings |
| `02_auth.js`                | Register, login, logout, me, profile, change password, forgot/reset password |
| `03_tickets_requester.js`   | Create ticket, read own tickets, send message, cancel, feedback, priority promotion |
| `04_tickets_admin.js`       | Staff: list all tickets, PATCH ticket, assign, status, events, export, stream |
| `05_sse_stream.js`          | SSE stream opens, receives connected event within timeout |
| `06_notifications.js`       | Create/list/patch/delete channels, templates, routing rules, logs |
| `07_admin_users.js`         | List users, get user, grant/revoke role, suspend/unsuspend |
| `08_content.js`             | Public guides, software, service status board |
| `09_rate_limits.js`         | Auth throttle triggers on repeated bad logins |
| `10_load_tickets.js`        | 20 VUs × 30 s sustained ticket submission + retrieval |
| `11_breakpoint_backend.js`  | **Breakpoint** — ramps 1→300 VUs against Django directly. p95 SLO < 500 ms, p99 SLO < 1 s. Reports exact latency at each stage |
| `12_breakpoint_frontend.js` | **Breakpoint** — same ramp against Next.js (port 3000). Tests page loads, API proxy, SSE Route Handler. p99 SLO < 1.2 s |
| `13_breakpoint_endtoend.js` | **Breakpoint** — ramps through Cloudflare → Next.js → Django. The real user path. E2E_MAX_VUS controls ceiling. p99 SLO < 2 s |

## How to read breakpoint results

Run with `--out csv=results.csv` then plot p99 latency vs VU count.
The VU stage where p99 first crosses the SLO is your **breakpoint** —
the maximum concurrent users the system can handle within acceptable latency.

```bash
k6 run --out csv=backend_results.csv k6/11_breakpoint_backend.js

# In Python/pandas:
# df = pd.read_csv('backend_results.csv')
# p99 = df[df.metric_name=='http_req_duration'].groupby('timestamp')['metric_value'].quantile(0.99)
# p99.plot(title='p99 latency over time (VU ramp)')
```

The `abortOnFail: false` on all breakpoint thresholds means the test runs
to completion even after the SLO is breached — this is intentional so you
can see the full degradation curve, not just where it first failed.
