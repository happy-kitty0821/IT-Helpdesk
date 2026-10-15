# IIC IT & NOC Helpdesk

A full-featured IT support ticket system for Itahari International College,
built with **Django 6.1** (backend) and **Next.js 16** (frontend). Students
and staff submit support requests through a public portal; IT agents and
service leads manage them through a real-time admin queue with live updates
via Server-Sent Events.

---

## Table of contents

1. [Architecture](#architecture)
2. [Feature overview](#feature-overview)
3. [Tech stack](#tech-stack)
4. [Project structure](#project-structure)
5. [Local development](#local-development)
6. [Environment variables](#environment-variables)
7. [Database migrations](#database-migrations)
8. [Running the application](#running-the-application)
9. [Authentication](#authentication)
10. [Role system](#role-system)
11. [Ticket state machine](#ticket-state-machine)
12. [SLA alerting (Celery)](#sla-alerting-celery)
13. [Email system](#email-system)
14. [SSE real-time updates](#sse-real-time-updates)
15. [File uploads](#file-uploads)
16. [Excel report export](#excel-report-export)
17. [Deployment](#deployment)
18. [CI/CD — Jenkins](#cicd--jenkins)
19. [Performance tests (k6)](#performance-tests-k6)
20. [API documentation](#api-documentation)

---

## Architecture

```
Browser
  └─► Cloudflare Tunnel  (ithelpdesk-iic.cloud-dev.tech)
        └─► Next.js 16   (port 3000, pnpm / Node.js)
              ├─► Static & server-rendered pages
              ├─► /api/v1/*  →  proxy rewrites → Django
              ├─► /api/v1/tickets/[id]/stream/  →  SSE Route Handler
              └─► /api/v1/admin/summary/stream/ →  SSE Route Handler
                    └─► Django 6.1 / Gunicorn gthread  (port 8000)
                          ├─► SQLite (dev) / PostgreSQL (production)
                          ├─► Redis  (Celery broker + result backend)
                          ├─► Celery worker  (background tasks)
                          └─► Celery beat    (periodic SLA checks)
```

**SSE streams bypass the Next.js rewrite proxy** (which buffers responses)
via dedicated App Router Route Handlers that forward `upstream.body`
(a `ReadableStream`) directly to the browser. This means SSE events arrive
in real time through Cloudflare without buffering.

---

## Feature overview

### Student / public portal

- Submit support tickets with custom form fields per service category
- Real-time ticket status updates via SSE (no page refresh)
- Message thread with IT staff
- Cancel or close own tickets
- Priority escalation requests
- Post-resolution satisfaction feedback (1–5 stars)
- Email verification on registration
- Password reset by email
- Google Workspace SSO
- Self-service guides (PDF viewer) and software catalogue

### Staff admin panel (`/admin`)

- **Ticket queue** — filterable, searchable, paginated; live update badge
- **Overdue badge** — tickets that breach SLA thresholds show a red ⚠ Overdue chip
- **Assign to self / others** — IT NOC interns can self-assign within their category scope
- **Status transitions** — enforced state machine (no illegal backwards jumps)
- **Take ownership** — interns self-assign; status auto-advances to In Progress
- **Account recovery workflow** — send backup code + temp password; status auto-resolves
- **Stage progress bar** — per-category workflow stages with visual tracker
- **Excel export** — 4-sheet audit workbook with charts (Ticket Register, Analytics, Audit Trail, Role Audit Events)
- **Real-time admin dashboard** — KPI cards via SSE stream
- **Notifications** — configurable channels (Discord, Teams, Slack, email SMTP/Mailgun), routing rules, DB-editable templates, activity logs
- **User management** — grant/revoke roles, suspend/unsuspend, set superuser
- **Rate limiting** — configurable rules with violation tracking
- **Service status board** — per-category operational status
- **Content management** — guides (PDF) and software catalogue
- **Announcements** — time-scheduled banners on the public home page
- **Site settings** — office hours, support email, recovery credential destination

---

## Tech stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Backend framework | Django | 6.1.1 |
| REST API | Django REST Framework | 3.18.1 |
| ASGI/WSGI server | Gunicorn (gthread workers) | — |
| Task queue | Celery + Redis | 5.5.3 / 5.2.1 |
| Frontend framework | Next.js (App Router) | 16.1.6 |
| Frontend language | TypeScript + React | 19.2.3 |
| Styling | Plain CSS (globals.css) | — |
| Animation | Motion (formerly Framer Motion) | — |
| Icons | Lucide React | — |
| Excel export | openpyxl | 3.1.5 |
| API schema | drf-spectacular | 0.30.0 |
| Package manager (frontend) | pnpm | — |
| Database (dev) | SQLite | — |
| Database (production) | PostgreSQL (recommended) | — |
| Tunnel | Cloudflare Tunnel (cloudflared) | — |
| CI/CD | Jenkins | — |
| Load / perf tests | k6 | 0.54+ |

---

## Project structure

```
IIC-IT Helpdesk/
├── backend/
│   ├── helpdesk/              # Django app — all models, views, serializers
│   │   ├── migrations/        # 39+ migrations
│   │   ├── templates/email/   # HTML email templates (base + per-event)
│   │   ├── models.py          # Ticket, User, RoleGrant, EmailTemplate, …
│   │   ├── views.py           # All API views + SSE stream views
│   │   ├── serializers.py     # DRF serializers
│   │   ├── signals.py         # Post-save signals (notifications, overdue clear)
│   │   ├── tasks.py           # Celery tasks (check_stale_tickets)
│   │   ├── notifications.py   # Channel dispatch, webhook text builder
│   │   ├── email_dispatch.py  # Unified email sender (DB template + transport)
│   │   ├── permissions.py     # Custom DRF permissions + role helpers
│   │   └── urls.py            # All URL patterns
│   ├── Project/
│   │   ├── settings.py        # Django settings (reads .env)
│   │   ├── celery.py          # Celery app instance
│   │   └── urls.py
│   ├── gunicorn.conf.py       # Gunicorn config (gthread, timeout, workers)
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── app/
│   │   ├── admin/             # Staff management pages
│   │   │   ├── tickets/       # Live ticket queue
│   │   │   ├── notifications/ # Dashboard + channels + templates + routing
│   │   │   ├── users/         # User management
│   │   │   └── …
│   │   ├── tickets/           # Student ticket pages
│   │   ├── api/v1/
│   │   │   ├── tickets/[id]/stream/route.ts   # SSE Route Handler
│   │   │   ├── admin/summary/stream/route.ts  # Admin SSE Route Handler
│   │   │   └── upload/        # Chunked upload Route Handlers
│   │   └── …
│   ├── hooks/
│   │   └── use-ticket-stream.ts   # EventSource hook
│   ├── lib/                   # Auth helpers, API client, animations
│   ├── components/            # SiteHeader, AdminShell, …
│   ├── next.config.ts         # Rewrites, proxyTimeout, SSE headers
│   └── .env.example
├── k6/                        # Performance + functional tests
│   ├── helpers.js
│   ├── 01_health_public.js … 13_breakpoint_endtoend.js
│   └── README.md
├── deploy/
│   └── README.md              # Server config instructions
├── cloudflared-config.yml     # Cloudflare Tunnel config
├── Jenkinsfile                # CI/CD pipeline
└── README.md                  # This file
```

---

## Local development

### Prerequisites

- Python 3.11+
- Node.js 20+ and pnpm (`npm install -g pnpm`)
- Redis (for Celery — optional for basic dev without SLA alerting)

### 1. Clone and set up backend

```bash
cd backend

# Create and activate virtual environment
python -m venv venv
source venv/bin/activate          # Linux/macOS
# venv\Scripts\activate           # Windows

# Install dependencies
pip install -r requirements.txt

# Copy env file and fill in values
cp .env.example .env
```

### 2. Run migrations and bootstrap admin

```bash
cd backend
python manage.py migrate
python manage.py bootstrap_admin --password "YourSecurePassword123!"
```

### 3. Set up frontend

```bash
cd frontend
cp .env.example .env.local
pnpm install
```

### 4. Start the application

```bash
# Terminal 1 — Django
cd backend
python manage.py runserver 127.0.0.1:8000

# Terminal 2 — Next.js
cd frontend
pnpm dev

# Terminal 3 — Celery worker + beat (optional, needed for SLA alerts)
cd backend
celery -A Project worker --beat --loglevel=info
```

Open `http://localhost:3000`.

---

## Environment variables

### Backend (`backend/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `DJANGO_SECRET_KEY` | Django secret key | insecure dev key |
| `DJANGO_DEBUG` | Enable debug mode | `true` |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated allowed hosts | `localhost,127.0.0.1` |
| `ALLOWED_REGISTRATION_DOMAINS` | Email domains allowed to register | `iic.edu.np` |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth Web client ID | — |
| `CSRF_TRUSTED_ORIGINS` | Comma-separated trusted origins | `http://localhost:3000` |
| `HELPDESK_URL` | Public frontend URL (used in emails) | `http://localhost:3000` |
| `REDIS_URL` | Redis connection URL | `redis://127.0.0.1:6379/0` |
| `MAILER_BACKEND` | Django mail backend class | console backend |
| `MAILER_HOST` | SMTP host | `localhost` |
| `MAILER_PORT` | SMTP port | `587` |
| `MAILER_USERNAME` | SMTP username | — |
| `MAILER_PASSWORD` | SMTP password | — |
| `VERIFICATION_FROM_EMAIL` | From address for system emails | `noreply@iic.edu.np` |
| `EMAIL_VERIFICATION_ENABLED` | Require email verification | `true` |
| `SLA_SUBMITTED_HOURS` | Hours before submitted ticket is overdue | `2` |
| `SLA_TRIAGED_HOURS` | Hours before triaged ticket is overdue | `4` |
| `SLA_IN_PROGRESS_HOURS` | Hours before in-progress ticket is overdue | `24` |
| `SLA_WAITING_REQUESTER_HOURS` | Hours before waiting ticket is overdue | `48` |
| `SLA_ESCALATION_MULTIPLIER` | Multiplier for escalation threshold | `2.0` |
| `SLA_ALERT_COOLDOWN_HOURS` | Min hours between repeat alerts | `4` |
| `DJANGO_INTERNAL_URL` | Internal Django URL used by Next.js | `http://127.0.0.1:8000` |
| `MEDIA_ACCEL_REDIRECT` | Use Nginx X-Accel-Redirect for media | `false` |

### Frontend (`frontend/.env.local`)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth Web client ID |
| `NEXT_PUBLIC_DJANGO_URL` | Public Django URL (for SSE direct connect fallback) |
| `NEXT_PUBLIC_SITE_URL` | Public site URL (used in structured data) |
| `DJANGO_INTERNAL_URL` | Internal Django URL for server-side fetches and SSE Route Handlers |

---

## Database migrations

```bash
cd backend

# Apply all migrations
python manage.py migrate

# Create a new migration after model changes
python manage.py makemigrations helpdesk --name "describe_your_change"

# Check for pending migrations
python manage.py showmigrations helpdesk
```

Notable migrations:
- `0001` — initial schema (User, Ticket, ServiceCategory, …)
- `0005` — role system (RoleGrant, RoleAuditEvent)
- `0037` — SLA overdue fields (`is_overdue`, `last_stale_alert_at`)
- `0038` — email verification + password reset event types
- `0039` — `use_file_fallback` on EmailTemplate
- `0040` — seed default email templates
- `0041` — fix account recovery template state

---

## Running the application

### Development

```bash
# Backend (auto-reload)
cd backend && python manage.py runserver 127.0.0.1:8000

# Frontend (hot reload)
cd frontend && pnpm dev

# Celery (SLA alerts, required for overdue badge to work)
cd backend && celery -A Project worker --beat --loglevel=info
```

### Production (on the server)

```bash
# Backend — managed by systemd
sudo systemctl start iic-helpdesk-backend.service

# Frontend — managed by systemd
sudo systemctl start iic-helpdesk-frontend.service

# Celery worker — managed by systemd
sudo systemctl start iic-helpdesk-celery-worker.service

# Celery beat — managed by systemd
sudo systemctl start iic-helpdesk-celery-beat.service

# Cloudflare Tunnel
sudo systemctl start cloudflared
```

---

## Authentication

- **Email/username + password** — `POST /api/v1/auth/login/`
- **Google Workspace SSO** — `POST /api/v1/auth/google/` (verifies token, domain, audience)
- **Session-based** — Django sessions with `SameSite=Lax` cookies
- **CSRF** — required on all writes; `GET /api/v1/auth/csrf/` returns the token
- **Email verification** — new password-registered accounts must verify before accessing the portal
- **Registration domain restriction** — configurable via `ALLOWED_REGISTRATION_DOMAINS`

---

## Role system

Roles are stored in `RoleGrant` rows (not Django groups). Each grant can have an optional expiry date. All role changes are immutably logged in `RoleAuditEvent`.

| Role | Access level |
|------|-------------|
| `administrator` | Full access + user management |
| `service_lead` | All tickets + assign + configure services |
| `it_agent` | All tickets + assign |
| `it_noc_intern` | Self-assign within scoped categories only |
| `designated_approver` | Approve waiting_approval tickets |
| `content_editor` | Manage guides and software |
| `faculty_staff` | Submit tickets (staff category access) |
| `student` | Submit tickets (student category access) |
| `visitor` | Submit tickets (public category access) |

**Username-based programme lock**: usernames starting with `np0cp4a` are locked to _BSc (Hons) Computing_; `np05ba` to _BA (Hons) Business Administration_. The serializer enforces this server-side.

---

## Ticket state machine

Status transitions are enforced both in `TicketUpdateSerializer.validate_status` (PATCH endpoint) and `TicketStatusView` (POST /status/). Invalid transitions return HTTP 400.

```
submitted  ──► triaged ──► in_progress ──► waiting_requester ──► resolved ──► closed
     │              │           │                  │                  │
     └── cancelled  └── cancelled └── cancelled    └── cancelled      └── in_progress (re-open)
```

**Intern transitions** are a narrower subset — interns cannot cancel tickets or close them directly.

The frontend status dropdown only shows valid next states based on the current status and the user's role — illegal options are never rendered.

---

## SLA alerting (Celery)

The `check_stale_tickets` Celery beat task runs every 15 minutes. It:

1. Scans tickets in `submitted`, `triaged`, `in_progress`, `waiting_requester` states
2. Compares age against the SLA threshold for each status (configurable via env vars)
3. Sets `ticket.is_overdue = True` and sends a `ticket_stale` notification
4. Escalates (cc's service leads) when the escalation threshold (2× first threshold) is breached
5. Clears `is_overdue` and `last_stale_alert_at` when a staff member takes action

The overdue badge (⚠ Overdue in red) appears in both the admin ticket table and the slide-in panel, updated in real time via SSE.

**Run Celery in development:**

```bash
cd backend
celery -A Project worker --beat --loglevel=info
```

**Production — two separate systemd services:**

```bash
# Worker
celery -A Project worker --loglevel=info

# Beat scheduler
celery -A Project beat --loglevel=info
```

---

## Email system

All outgoing emails go through a single `resolve_and_send()` function in
`helpdesk/email_dispatch.py`. It resolves transport and template in priority order:

**Transport precedence:**
1. `NotificationChannel` (email_smtp / email_mailgun) with a rule for the event type
2. Active `EmailConfiguration` DB row (admin-configurable SMTP override)
3. `.env` `MAILER_*` vars (always-available fallback)

**Template precedence:**
1. Active `EmailTemplate` DB row for the event type — admin-editable at runtime in Admin → Notifications → Templates
2. On-disk HTML file at `helpdesk/templates/email/{event_type}.html` — the safe fallback, never deleted

Each DB template has a **"Use default file template"** toggle. When on, the DB record is saved but the on-disk file is used — useful for reverting to the built-in layout without losing custom copy.

**Supported event types:** `ticket_submitted`, `ticket_resolved`, `ticket_assigned`, `ticket_reply`, `status_changed`, `waiting_requester`, `priority_changed`, `account_recovery`, `recovery_unable_to_verify`, `ticket_stale`, `email_verification`, `password_reset`.

---

## SSE real-time updates

Two SSE endpoints:

| Endpoint | Handler | Used by |
|----------|---------|---------|
| `/api/v1/tickets/{id}/stream/` | `TicketStreamView` (Django) + Next.js Route Handler | Student ticket page + admin panel |
| `/api/v1/admin/summary/stream/` | `AdminDashboardStreamView` (Django) + Next.js Route Handler | Admin dashboard |

**Why Route Handlers?** Next.js rewrite proxy buffers response bodies — for infinite SSE streams this means zero bytes reach the browser. Route Handlers at `app/api/v1/tickets/[id]/stream/route.ts` and `app/api/v1/admin/summary/stream/route.ts` return `upstream.body` (a `ReadableStream`) directly, bypassing the buffer.

**Why `fallback` rewrites?** The `afterFiles` phase in Next.js 16 runs before App Router Route Handlers. Moving `/api/v1/tickets/:path*` and `/api/v1/admin/:path*` to the `fallback` phase ensures Route Handlers execute first for stream paths while all other ticket/admin API calls still proxy to Django.

---

## File uploads

Large file uploads (software installers, guide PDFs) use a **chunked upload** system to bypass Cloudflare's 100 MB body limit:

1. `POST /api/v1/upload/init/` — create a `ChunkedUpload` session
2. `PUT /api/v1/upload/{id}/chunk/{index}/` — upload each 2 MB chunk
3. `POST /api/v1/upload/{id}/finalize/` — reassemble and attach to the target model

The chunk endpoints are handled by **Next.js Route Handlers** (not rewrites) because Next.js's rewrite proxy also drops multipart/form-data bodies on PUT requests. The Route Handlers read the raw request body and forward it to Django.

---

## Excel report export

`GET /api/v1/tickets/export/` returns a multi-sheet `.xlsx` workbook:

| Sheet | Contents |
|-------|----------|
| **Ticket Register** | One row per ticket — all fields, first-response time, reopen count, SLA bucket, satisfaction feedback |
| **Analytics Summary** | KPI cards, 8 charts (status pie, priority pie, category bar, SLA bar, assignee workload, satisfaction, day-of-week, monthly trend) |
| **Ticket Audit Trail** | Every `TicketEvent` across exported tickets — who changed what and when |
| **Role Audit Events** | Complete `RoleAuditEvent` log — all role grants and revocations |

Charts reference live cell data — changing the filter regenerates them automatically in Excel.

---

## Deployment

See `deploy/README.md` for detailed server configuration including:
- Cloudflare dashboard settings
- `cloudflared` config (`keepAliveTimeout: 3600s` — required for SSE)
- Gunicorn systemd service (`gthread` workers)
- Next.js production build and service

### Quick deployment via Jenkins

Push to the configured branch and the Jenkins pipeline handles:

1. Redis check (fails build if Redis is not installed)
2. Backend dependency install
3. Django system check + tests
4. Frontend dependency install + build
5. `rsync` deploy (excludes `.env`, `venv`, `db.sqlite3`, `media`)
6. Database migrations
7. `collectstatic`
8. Restart backend, Celery worker, Celery beat, frontend services
9. Health check (`/api/v1/health/` + `redis-cli ping`)

---

## CI/CD — Jenkins

`Jenkinsfile` at the repo root defines the pipeline. Key stages:

| Stage | What it does |
|-------|-------------|
| Infrastructure - Redis | Checks Redis is installed and running; fails build if not |
| Backend - Install | `pip install -r requirements.txt` |
| Backend - Validate | `python manage.py check` |
| Backend - Tests | `python manage.py test` |
| Frontend - Install | `pnpm install --frozen-lockfile` |
| Frontend - Build | `pnpm build` (injects `NEXT_PUBLIC_GOOGLE_CLIENT_ID` from credentials store) |
| Deploy Backend | `rsync` to `/var/www/iic-app/backend/` |
| Database Migration | `manage.py migrate --noinput` |
| Collect Static | `manage.py collectstatic --noinput` |
| Deploy Frontend | Runs `iic-helpdesk-deploy-frontend` helper script |
| Restart Backend | `systemctl restart iic-helpdesk-backend.service` |
| Restart Celery | Restarts worker + beat services |
| Restart Frontend | `systemctl restart iic-helpdesk-frontend.service` |
| Health Check | Pings backend API, Redis, and frontend — retries 10× |

---

## Performance tests (k6)

The `k6/` folder contains 13 test files:

### Functional tests (`01` – `10`)

Verify correctness at low concurrency — all checks must pass.

```bash
k6 run -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... k6/02_auth.js
k6 run -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... k6/03_tickets_requester.js
# … see k6/README.md for full commands
```

### Breakpoint tests (`11` – `13`)

Ramp VUs from 1 → 300, finding the exact point where p99 exceeds 1 second.
`abortOnFail: false` means the full degradation curve is captured.

| Test | Target | p99 SLO |
|------|--------|---------|
| `11_breakpoint_backend.js` | Django :8000 | 1 000 ms |
| `12_breakpoint_frontend.js` | Next.js :3000 | 1 200 ms |
| `13_breakpoint_endtoend.js` | Public domain | 2 000 ms |

```bash
# Backend breakpoint
k6 run -e BACKEND_URL=http://127.0.0.1:8000 k6/11_breakpoint_backend.js

# End-to-end (start conservatively)
k6 run -e E2E_MAX_VUS=50 k6/13_breakpoint_endtoend.js
```

See `k6/README.md` for full documentation, SLO thresholds, CSV export,
and a Python script to plot p95/p99 vs VU count.

---

## API documentation

Interactive API documentation is available at:

| URL | Tool |
|-----|------|
| `/api/v1/api/docs/` | Swagger UI (drf-spectacular) |
| `/api/v1/api/redoc/` | Redoc |
| `/api/v1/api/schema/` | Raw OpenAPI 3 schema (YAML/JSON) |

---

## Development notes

- **SQLite in production** — supported but not recommended for more than ~20 concurrent users due to write-lock contention. Migrate to PostgreSQL before going to production with real users. The Django ORM makes this a settings change only — no code changes needed.
- **Celery + Redis** — required for the overdue badge to work. Without them, `is_overdue` is never set and the badge never appears.
- **`proxyTimeout: 0`** in `next.config.ts` — disables the Next.js proxy timeout entirely. Gunicorn's `timeout = 120` governs the upstream side instead.
- **`abortOnFail: false`** in breakpoint tests — intentional. Tests run to completion so you see the full degradation curve, not just where it first failed.
