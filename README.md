# IIC IT & NOC Helpdesk

> A production-grade IT support ticket system for **Itahari International College** —
> built with Django 6.1 and Next.js 16, deployed via Cloudflare Tunnel with
> real-time SSE updates, Celery-powered SLA alerting, and a four-sheet
> audit-grade Excel export.

---

## Table of contents

1. [System architecture](#1-system-architecture)
2. [Feature overview](#2-feature-overview)
3. [Tech stack](#3-tech-stack)
4. [Project structure](#4-project-structure)
5. [Local development](#5-local-development)
6. [Environment variables](#6-environment-variables)
7. [Management commands](#7-management-commands)
8. [Database migrations](#8-database-migrations)
9. [Authentication](#9-authentication)
10. [Role system](#10-role-system)
11. [Ticket state machine](#11-ticket-state-machine)
12. [SLA alerting — Celery](#12-sla-alerting--celery)
13. [Email system](#13-email-system)
14. [SSE real-time updates](#14-sse-real-time-updates)
15. [File uploads](#15-file-uploads)
16. [Excel report export](#16-excel-report-export)
17. [Deployment](#17-deployment)
18. [CI/CD — Jenkins](#18-cicd--jenkins)
19. [Performance tests — k6](#19-performance-tests--k6)
20. [API documentation](#20-api-documentation)
21. [Development notes](#21-development-notes)

---

## 1. System architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PUBLIC INTERNET                                │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │  HTTPS
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CLOUDFLARE EDGE                                     │
│   DNS · TLS termination · DDoS protection · HTTP/2                          │
│   Domain: ithelpdesk-iic.cloud-dev.tech                                     │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │  Cloudflare Tunnel (encrypted)
                                   │  keepAliveTimeout: 3600 s
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         LXC CONTAINER  (Linux)                              │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  cloudflared  (tunnel daemon)                                        │  │
│  │  Forwards traffic to Next.js :3000                                   │  │
│  └───────────────────────────┬──────────────────────────────────────────┘  │
│                               │  HTTP/1.1  (localhost)                      │
│                               ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  Next.js 16  (Node.js · pnpm · port 3000)                           │  │
│  │                                                                      │  │
│  │  ┌─────────────────────┐  ┌──────────────────────────────────────┐  │  │
│  │  │  Static pages        │  │  API proxy  (next.config.ts rewrites) │  │  │
│  │  │  /  /tickets  /help  │  │  /api/v1/* → afterFiles → Django     │  │  │
│  │  │  /services  /status  │  │                                      │  │  │
│  │  └─────────────────────┘  └──────────────────────┬───────────────┘  │  │
│  │                                                   │                  │  │
│  │  ┌────────────────────────────────────────────────┴───────────────┐  │  │
│  │  │  SSE Route Handlers  (fallback rewrites — bypass proxy buffer)  │  │  │
│  │  │  /api/v1/tickets/[id]/stream/         → ReadableStream          │  │  │
│  │  │  /api/v1/admin/summary/stream/        → ReadableStream          │  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┬─────────────────┘  │
│                                                        │  HTTP/1.1           │
│                                                        ▼                    │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  Django 6.1  +  Gunicorn gthread  (port 8000)                       │  │
│  │                                                                      │  │
│  │  workers = cpu_count   threads = 4   timeout = 120 s                │  │
│  │                                                                      │  │
│  │  DRF REST API  ·  SSE StreamingHttpResponse  ·  Session auth        │  │
│  │  Ticket state machine  ·  Role system  ·  SLA engine                │  │
│  └───────┬──────────────────────────────────────┬────────────────────-─┘  │
│           │  Django ORM                           │  redis-py               │
│           ▼                                       ▼                        │
│  ┌──────────────────┐              ┌──────────────────────────────────┐    │
│  │  SQLite (dev)    │              │  Redis  :6379                    │    │
│  │  PostgreSQL (prod│              │                                  │    │
│  └──────────────────┘              │  Celery broker + result backend  │    │
│                                    └──────────┬───────────────────────┘    │
│                                               │                            │
│                              ┌────────────────┴──────────────────────┐    │
│                              │  Celery workers                        │    │
│                              │  · check_stale_tickets  (beat / 15 m)  │    │
│                              │  · fire ticket_stale notification       │    │
│                              │  · set ticket.is_overdue = True         │    │
│                              └───────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Request routing detail

```
Browser request  →  /api/v1/tickets/{id}/stream/
                                   │
         Next.js routing engine checks phases in order:
                                   │
          1. beforeFiles rewrites  ─── (none match)
          2. Filesystem pages      ─── (none match)
          3. afterFiles rewrites   ─── tickets/:path* NOT here → skip  ◄── key fix
          4. App Router handler    ─── app/api/v1/tickets/[id]/stream/route.ts ✓
          5. fallback rewrites     ─── tickets/:path* here (catches other API calls)
```

---

## 2. Feature overview

### Student / public portal

| Feature | Detail |
|---------|--------|
| Ticket submission | Custom form fields per service category |
| Real-time updates | SSE — status, assignee, stage update without page refresh |
| Overdue badge | Red ⚠ chip when ticket breaches SLA |
| Message thread | Two-way conversation with IT staff |
| Ticket actions | Cancel, close, priority escalation request |
| Satisfaction feedback | 1–5 star rating + comment after resolution |
| Account recovery | Dedicated workflow with credentials email |
| Authentication | Email/password, Google Workspace SSO |
| Self-service | PDF guides viewer, software catalogue, service status board |

### Staff admin panel (`/admin`)

| Feature | Detail |
|---------|--------|
| Live ticket queue | Filterable, searchable, paginated with SSE overdue badge |
| Status transitions | Enforced state machine — illegal moves rejected with clear error |
| Intern self-assign | IT NOC interns take ownership within category scope |
| Account recovery | Send backup code + temp password; auto-resolves ticket + completes stages |
| Unable to verify | Auto-sets `waiting_requester`; creates history event |
| Stage tracker | Per-category workflow stages with animated progress bar |
| Excel export | 4-sheet audit workbook with 8 charts (see §16) |
| Real-time dashboard | KPI cards updated via SSE stream |
| Notification system | Channels (Discord/Teams/Slack/email), routing rules, DB-editable templates |
| User management | Grant/revoke roles, suspend/unsuspend, set superuser |
| Rate limiting | Configurable rules with per-scope violation tracking |
| Service status board | Per-category operational status |
| Content management | Guides (PDF upload) and software catalogue |
| Announcements | Time-scheduled banners on the public home page |
| Site settings | Office hours, support email, credential destination |

---

## 3. Tech stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Backend framework | Django | 6.1.1 |
| REST API | Django REST Framework | 3.18.1 |
| WSGI server | Gunicorn (gthread workers) | — |
| Task queue / broker | Celery + Redis | 5.5.3 / 5.2.1 |
| Frontend framework | Next.js (App Router) | 16.1.6 |
| Frontend language | TypeScript + React | 19.2.3 |
| Styling | Plain CSS (`globals.css`) + CSS variables | — |
| Animation | Motion (Framer Motion v11) | — |
| Icons | Lucide React | — |
| Excel export | openpyxl | 3.1.5 |
| API schema | drf-spectacular | 0.30.0 |
| Package manager (FE) | pnpm | — |
| Database (dev) | SQLite | — |
| Database (prod) | PostgreSQL (recommended) | — |
| Tunnel | Cloudflare Tunnel (cloudflared) | — |
| CI/CD | Jenkins | — |
| Performance tests | k6 | 0.54+ |

---

## 4. Project structure

```
IIC-IT Helpdesk/
│
├── backend/
│   ├── helpdesk/                     ← Django app (all business logic)
│   │   ├── management/
│   │   │   └── commands/
│   │   │       ├── bootstrap_admin.py  ← Create / update initial superuser
│   │   │       └── seed_rate_limits.py ← Seed default rate-limit rules
│   │   ├── migrations/               ← 41 migrations
│   │   ├── templates/
│   │   │   └── email/                ← HTML email templates
│   │   │       ├── base.html           (IIC logo + brand header)
│   │   │       ├── email_verification.html
│   │   │       ├── password_reset.html
│   │   │       ├── recovery_credentials.html
│   │   │       └── recovery_unable_to_verify.html
│   │   ├── models.py                 ← All data models
│   │   ├── views.py                  ← All API + SSE views
│   │   ├── serializers.py            ← DRF serializers (incl. state machine)
│   │   ├── signals.py                ← Post-save triggers (notifications, overdue)
│   │   ├── tasks.py                  ← Celery tasks (check_stale_tickets)
│   │   ├── notifications.py          ← Channel dispatch + webhook text
│   │   ├── email_dispatch.py         ← Unified email sender
│   │   ├── email_config_service.py   ← Transport resolution (DB → env fallback)
│   │   ├── email_verification.py     ← Verification token send/verify
│   │   ├── permissions.py            ← Custom DRF permissions + role helpers
│   │   ├── throttling.py             ← DB-driven rate limiting engine
│   │   └── urls.py                   ← All URL patterns
│   ├── Project/
│   │   ├── celery.py                 ← Celery app instance + beat schedule
│   │   ├── settings.py               ← Django settings
│   │   └── urls.py
│   ├── iic-logo.png                  ← College logo (embedded in email headers)
│   ├── gunicorn.conf.py              ← Gunicorn config
│   ├── requirements.txt
│   └── .env.example
│
├── frontend/
│   ├── app/
│   │   ├── admin/                    ← Staff management pages
│   │   │   ├── tickets/page.tsx        (live queue with SSE)
│   │   │   ├── notifications/page.tsx  (Dashboard + channels + templates)
│   │   │   ├── users/page.tsx
│   │   │   └── …
│   │   ├── tickets/
│   │   │   ├── page.tsx              ← Student ticket list
│   │   │   └── [id]/page.tsx         ← Ticket detail + SSE + messages
│   │   ├── api/v1/                   ← Next.js Route Handlers
│   │   │   ├── tickets/[id]/stream/route.ts   ← SSE ticket stream
│   │   │   ├── admin/summary/stream/route.ts  ← SSE admin dashboard
│   │   │   └── upload/               ← Chunked file upload handlers
│   │   └── …
│   ├── hooks/
│   │   └── use-ticket-stream.ts      ← EventSource hook (auto-reconnect)
│   ├── components/
│   │   ├── site-header.tsx
│   │   └── admin-shell.tsx
│   ├── lib/
│   │   ├── auth.ts                   ← AuthUser type + role helpers
│   │   └── …
│   ├── next.config.ts                ← Rewrites, proxyTimeout, SSE headers
│   └── .env.example
│
├── k6/                               ← Performance + functional tests
│   ├── helpers.js                    ← Shared auth + request utilities
│   ├── 01_health_public.js           ← Public endpoints
│   ├── 02_auth.js … 10_load_tickets.js
│   ├── 11_breakpoint_backend.js      ← Django capacity test
│   ├── 12_breakpoint_frontend.js     ← Next.js capacity test
│   ├── 13_breakpoint_endtoend.js     ← Full-stack capacity test
│   └── README.md
│
├── deploy/
│   └── README.md                     ← Server config (Nginx, Gunicorn, cloudflared)
│
├── cloudflared-config.yml            ← Tunnel config (keepAliveTimeout: 3600s)
├── Jenkinsfile                       ← CI/CD pipeline
└── README.md                         ← This file
```

---

## 5. Local development

### Prerequisites

- Python 3.11+
- Node.js 20+ and pnpm (`npm install -g pnpm`)
- Redis (optional — only needed for Celery/SLA alerting)

### Step-by-step

```bash
# ── 1. Backend setup ──────────────────────────────────────────────────────────

cd backend
python -m venv venv
source venv/bin/activate          # Linux / macOS
# venv\Scripts\activate           # Windows

pip install -r requirements.txt
cp .env.example .env              # then edit .env with your values

python manage.py migrate
python manage.py bootstrap_admin --password "YourSecurePassword123!"
python manage.py seed_rate_limits  # optional but recommended

# ── 2. Frontend setup ─────────────────────────────────────────────────────────

cd ../frontend
cp .env.example .env.local        # then edit .env.local
pnpm install

# ── 3. Start everything ───────────────────────────────────────────────────────

# Terminal 1 — Django dev server
cd backend && python manage.py runserver 127.0.0.1:8000

# Terminal 2 — Next.js dev server
cd frontend && pnpm dev

# Terminal 3 — Celery (optional, for SLA overdue badge)
cd backend && celery -A Project worker --beat --loglevel=info
```

Open `http://localhost:3000`.

---

## 6. Environment variables

### Backend (`backend/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `DJANGO_SECRET_KEY` | Django secret key — must be long and random in production | insecure dev key |
| `DJANGO_DEBUG` | Enable debug mode | `true` |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated allowed hosts | `localhost,127.0.0.1` |
| `ALLOWED_REGISTRATION_DOMAINS` | Email domains permitted to self-register | `iic.edu.np` |
| `CSRF_TRUSTED_ORIGINS` | Comma-separated origins that may send CSRF-protected requests | `http://localhost:3000` |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth 2.0 Web client ID | — |
| `HELPDESK_URL` | Public frontend URL — used in outgoing emails | `http://localhost:3000` |
| `DJANGO_INTERNAL_URL` | Internal Django URL used by Next.js server-side fetches | `http://127.0.0.1:8000` |
| `REDIS_URL` | Redis connection URL for Celery broker + result backend | `redis://127.0.0.1:6379/0` |
| `MAILER_BACKEND` | Django mail backend class | console backend |
| `MAILER_HOST` | SMTP hostname | `localhost` |
| `MAILER_PORT` | SMTP port | `587` |
| `MAILER_USE_TLS` | Enable STARTTLS | `true` |
| `MAILER_USERNAME` | SMTP login username | — |
| `MAILER_PASSWORD` | SMTP app password | — |
| `VERIFICATION_FROM_EMAIL` | From address for system emails | `noreply@iic.edu.np` |
| `EMAIL_VERIFICATION_ENABLED` | Require email verification on registration | `true` |
| `PASSWORD_RESET_TOKEN_EXPIRY_HOURS` | Password reset link validity | `24` |
| `SLA_SUBMITTED_HOURS` | Hours until a submitted ticket is flagged overdue | `2` |
| `SLA_TRIAGED_HOURS` | Hours until a triaged ticket is flagged overdue | `4` |
| `SLA_IN_PROGRESS_HOURS` | Hours until an in-progress ticket is flagged overdue | `24` |
| `SLA_WAITING_REQUESTER_HOURS` | Hours until a waiting ticket is flagged overdue | `48` |
| `SLA_ESCALATION_MULTIPLIER` | Multiplier for escalation threshold (default: 2× first) | `2.0` |
| `SLA_ALERT_COOLDOWN_HOURS` | Minimum hours between repeated alerts for the same ticket | `4` |
| `MEDIA_ACCEL_REDIRECT` | Use Nginx `X-Accel-Redirect` for protected media (prod) | `false` |

### Frontend (`frontend/.env.local`)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth Web client ID (same as backend) |
| `NEXT_PUBLIC_DJANGO_URL` | Public Django URL — shown in browser; used for SSE fallback |
| `NEXT_PUBLIC_SITE_URL` | Canonical public URL — used in structured data / sitemaps |
| `DJANGO_INTERNAL_URL` | Internal Django URL for server-side fetches and SSE Route Handlers |

---

## 7. Management commands

All commands are run from the `backend/` directory with the virtual environment activated.

```bash
cd backend
source venv/bin/activate   # or venv\Scripts\activate on Windows
```

---

### `bootstrap_admin`

Creates or updates the initial administrator account. Safe to run multiple
times — it updates the existing account rather than creating a duplicate.

```bash
python manage.py bootstrap_admin \
  --username aayush.limbu \
  --email    aayush.limbu@iic.edu.np \
  --first-name Aayush \
  --last-name  "Wanem Limbu" \
  --password "YourSecurePassword123!"
```

Password can also be supplied via the `INITIAL_ADMIN_PASSWORD` environment
variable instead of the `--password` flag (recommended for CI):

```bash
INITIAL_ADMIN_PASSWORD="YourSecurePassword123!" \
  python manage.py bootstrap_admin
```

**Arguments:**

| Argument | Default | Description |
|----------|---------|-------------|
| `--username` | `aayush.limbu` | Django username |
| `--email` | `aayush.limbu@iic.edu.np` | Login email |
| `--first-name` | `Aayush` | Display first name |
| `--last-name` | `Wanem Limbu` | Display last name |
| `--password` | — | Password (required if env var not set) |

**When to use:**
- First server setup after a fresh database
- After a `manage.py flush` or database reset
- To rotate the admin password without accessing the database directly

---

### `seed_rate_limits`

Idempotently creates the default `RateLimitRule` rows. Safe to run multiple
times — it uses `get_or_create` so existing custom rules are never overwritten.

```bash
python manage.py seed_rate_limits
```

**Default rules created:**

| Scope | Label | Limit | Window | Action |
|-------|-------|-------|--------|--------|
| `auth_login` | Login attempts | 10 | minute | block (429) |
| `auth_register` | Registration attempts | 5 | hour | block |
| `auth_google` | Google SSO attempts | 10 | minute | block |
| `ticket_create` | Ticket submissions per user | 20 | hour | block |
| `ticket_message` | Ticket replies per user | 60 | hour | warn + log |
| `ticket_status` | Status transitions | 30 | hour | block |
| `public_api` | Public API reads per IP | 120 | minute | block |
| `admin_user_write` | Admin user management writes | 60 | hour | block |
| `admin_bulk` | Admin bulk/write operations | 120 | hour | warn + log |
| `export` | Excel export downloads | 5 | hour | block |
| `change_password` | Password change attempts | 5 | hour | block |

Rules can be further customised at runtime in **Admin → Rate Limits**.

**When to use:**
- First server setup
- After a database reset
- When adding a new deployment to a fresh database (Jenkins runs this automatically if added to the pipeline)

---

### Standard Django commands

These are Django built-ins used regularly in this project:

```bash
# Apply all pending migrations
python manage.py migrate

# Create a new migration after model changes
python manage.py makemigrations helpdesk --name "describe_your_change"

# List migration status
python manage.py showmigrations helpdesk

# Run all tests
python manage.py test helpdesk

# Run tests verbosely
python manage.py test helpdesk --verbosity=2

# Check for configuration errors
python manage.py check

# Collect static files for production
python manage.py collectstatic --noinput

# Start development server
python manage.py runserver 127.0.0.1:8000

# Open a Django shell
python manage.py shell

# Flush all data (DESTRUCTIVE — dev only)
python manage.py flush
```

---

## 8. Database migrations

```bash
# Apply all migrations
python manage.py migrate

# Create new migration after model change
python manage.py makemigrations helpdesk --name "describe_change"

# Check pending migrations
python manage.py showmigrations helpdesk
```

**Notable migrations:**

| Migration | What it adds |
|-----------|-------------|
| `0001_initial` | Base schema: User, Ticket, ServiceCategory |
| `0005_role_system` | RoleGrant, RoleAuditEvent |
| `0037_add_overdue_fields` | `is_overdue`, `last_stale_alert_at` on Ticket |
| `0038_add_email_event_types` | `email_verification`, `password_reset` event types |
| `0039_add_use_file_fallback` | `use_file_fallback` on EmailTemplate |
| `0040_seed_email_templates` | Default email templates for all event types |
| `0041_fix_account_recovery_templates` | Correct account_recovery template state |

---

## 9. Authentication

| Method | Endpoint | Notes |
|--------|----------|-------|
| Email / username + password | `POST /api/v1/auth/login/` | Both identifiers accepted |
| Google Workspace SSO | `POST /api/v1/auth/google/` | Verifies token, domain, audience |
| Logout | `POST /api/v1/auth/logout/` | Clears session |
| Current user | `GET /api/v1/auth/me/` | Returns roles, profile, `is_overdue` etc. |
| Email verification | `POST /api/v1/auth/verify-email/` | Required after password registration |
| Resend verification | `POST /api/v1/auth/resend-verification/` | — |
| Forgot password | `POST /api/v1/auth/forgot-password/` | Always returns 200 (no enumeration) |
| Reset password | `POST /api/v1/auth/reset-password/` | Consumes single-use token |
| Change password | `POST /api/v1/auth/change-password/` | Requires current password |
| Profile | `GET / PATCH /api/v1/auth/profile/` | Name, programme (locked for known prefixes), department |

Sessions use `SameSite=Lax` cookies. CSRF tokens are required on all
write operations — `GET /api/v1/auth/csrf/` returns the token.

**Username-based programme lock:** usernames starting with `np0cp4a` are
locked to _BSc (Hons) Computing_; `np05ba` to _BA (Hons) Business
Administration_. The serializer enforces this server-side — attempting to
change a locked programme returns HTTP 400 with a clear error message.

---

## 10. Role system

Roles are stored in `RoleGrant` rows (not Django groups). Each grant can
have an optional expiry date. All role changes are immutably logged in
`RoleAuditEvent`.

| Role | Access |
|------|--------|
| `administrator` | Full access + user management + superuser actions |
| `service_lead` | All tickets + assign + configure services + notifications |
| `it_agent` | All tickets + assign + admin queue |
| `it_noc_intern` | Self-assign within scoped categories only |
| `designated_approver` | Approve `waiting_approval` tickets |
| `content_editor` | Manage guides and software catalogue |
| `faculty_staff` | Submit tickets (staff-visible categories) |
| `student` | Submit tickets (student-visible categories) |
| `visitor` | Submit tickets (public categories) |

Intern category scope is configurable in **Admin → Settings → Intern Scope**.

---

## 11. Ticket state machine

Status transitions are enforced in both `TicketUpdateSerializer.validate_status`
(PATCH) and `TicketStatusView` (POST `/status/`). Invalid transitions return
HTTP 400 with a descriptive message.

```
                  ┌─────────────────────────────────────┐
                  │                                     │
   submitted ──►  triaged ──► in_progress ──► waiting_requester
       │             │             │                │
       │             │             │                │
       ▼             ▼             ▼                ▼
   cancelled     cancelled   waiting_approval    resolved ──► closed
                                  │                │
                                  │                └──► in_progress (re-open)
                                  ▼
                               resolved
```

**Intern transitions** are a narrower subset — interns may not cancel
tickets or close them directly.

The frontend status dropdown renders only valid next states based on the
current status and the caller's role — illegal options are never shown.

---

## 12. SLA alerting — Celery

The `check_stale_tickets` beat task runs every 15 minutes:

1. Scans tickets in `submitted`, `triaged`, `in_progress`, `waiting_requester`
2. Compares age against the SLA threshold for each status
3. Sets `ticket.is_overdue = True` → sends `ticket_stale` notification
4. Escalates (cc's service leads) at 2× the first threshold
5. Clears `is_overdue` and `last_stale_alert_at` when staff takes action

The **⚠ Overdue** badge appears in the admin ticket table and slide-in
panel, updated in real time via SSE.

```bash
# Development — single process (worker + scheduler)
celery -A Project worker --beat --loglevel=info

# Production — separate systemd services
celery -A Project worker --loglevel=info          # iic-helpdesk-celery-worker
celery -A Project beat   --loglevel=info          # iic-helpdesk-celery-beat
```

---

## 13. Email system

All outgoing emails route through `helpdesk/email_dispatch.py`:
`resolve_and_send(event_type, context, to_email)`.

**Transport precedence (highest → lowest):**

```
1. NotificationChannel (email_smtp / email_mailgun) with a rule for event_type
         ↓ (if none)
2. Active EmailConfiguration DB row   (Admin → Settings → Email Config)
         ↓ (if none)
3. .env MAILER_* variables            (always-available fallback)
```

**Template precedence:**

```
1. Active EmailTemplate DB row   (Admin → Notifications → Templates)
         ↓ (if none, or use_file_fallback = True)
2. On-disk HTML file             (helpdesk/templates/email/{event_type}.html)
```

Each DB template has a **"Use default file template"** toggle. When on, the
DB record is saved for future editing but the on-disk file is used — useful
for reverting without losing custom copy.

**Supported event types:**

| Event | When sent |
|-------|-----------|
| `ticket_submitted` | New ticket created (non-recovery categories) |
| `ticket_resolved` | Ticket moved to resolved |
| `ticket_assigned` | Ticket assigned or reassigned |
| `ticket_reply` | Staff reply sent |
| `status_changed` | Any status transition |
| `waiting_requester` | Ticket moved to waiting_requester |
| `priority_changed` | Priority escalated by requester |
| `account_recovery` | Credentials email sent to student |
| `recovery_unable_to_verify` | Identity could not be verified remotely |
| `ticket_stale` | SLA threshold breached — alert to assignee/leads |
| `email_verification` | Account registration verification link |
| `password_reset` | Password reset link |

---

## 14. SSE real-time updates

Two streaming endpoints, both served by **Next.js Route Handlers** (not
the rewrite proxy) to avoid response-body buffering:

| Endpoint | Django view | Next.js handler | Used by |
|----------|-------------|-----------------|---------|
| `/api/v1/tickets/{id}/stream/` | `TicketStreamView` | `app/api/v1/tickets/[id]/stream/route.ts` | Student ticket page + admin panel |
| `/api/v1/admin/summary/stream/` | `AdminDashboardStreamView` | `app/api/v1/admin/summary/stream/route.ts` | Admin dashboard KPIs |

**Why Route Handlers?** Next.js's `afterFiles` rewrite proxy buffers response
bodies — for infinite SSE streams the browser receives headers but zero
bytes. Route Handlers return `upstream.body` (a `ReadableStream`) directly,
bypassing the buffer entirely.

**Why `fallback` phase?** In Next.js 16, `afterFiles` rewrites run before App
Router Route Handlers. Moving `tickets/:path*` and `admin/:path*` to the
`fallback` phase ensures Route Handlers execute first for stream paths while
all other API calls still proxy to Django.

---

## 15. File uploads

Large files use a **three-step chunked upload** to bypass Cloudflare's
100 MB per-request body limit:

```
POST   /api/v1/upload/init/                     Create upload session
PUT    /api/v1/upload/{id}/chunk/{index}/        Upload each 2 MB chunk
POST   /api/v1/upload/{id}/finalize/             Reassemble + attach
```

Each step is a **Next.js Route Handler** (not a rewrite) because the Next.js
proxy drops multipart/form-data bodies on PUT requests.

---

## 16. Excel report export

`GET /api/v1/tickets/export/` returns a four-sheet `.xlsx` workbook:

| Sheet | Contents |
|-------|----------|
| **Ticket Register** | One row per ticket — all fields, SLA bucket, first-response time, reopen count, satisfaction feedback, custom extra fields |
| **Analytics Summary** | KPI cards + 8 embedded charts: status pie, priority pie, category bar, SLA distribution, assignee workload (total vs open), satisfaction distribution, day-of-week column, monthly volume trend |
| **Ticket Audit Trail** | Every `TicketEvent` across exported tickets — actor, action, from/to values, note, timestamp |
| **Role Audit Events** | Complete `RoleAuditEvent` log — all role grants and revocations, actor, target, department |

Charts reference live cell data and carry the IIC logo in each sheet header.

---

## 17. Deployment

See `deploy/README.md` for detailed server instructions. Summary:

```bash
# 1. Cloudflare Tunnel config
sudo cp cloudflared-config.yml /etc/cloudflared/config.yml
sudo nano /etc/cloudflared/config.yml   # fill in tunnel ID + credentials path
sudo systemctl restart cloudflared

# 2. Backend
cd /var/www/iic-app/backend
cp .env.example .env && nano .env
source venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py bootstrap_admin --password "..."
python manage.py seed_rate_limits
sudo systemctl restart iic-helpdesk-backend

# 3. Celery
sudo systemctl restart iic-helpdesk-celery-worker
sudo systemctl restart iic-helpdesk-celery-beat

# 4. Frontend
cd /var/www/iic-app/frontend
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart iic-helpdesk-frontend
```

---

## 18. CI/CD — Jenkins

The `Jenkinsfile` at the repo root defines the full deployment pipeline.

| Stage | What happens |
|-------|-------------|
| **Infrastructure - Redis** | `redis-cli ping` — fails build if Redis is missing or stopped |
| **Backend - Install** | `pip install -r requirements.txt` in the venv |
| **Backend - Validate** | `manage.py check` — zero issues required |
| **Backend - Tests** | `manage.py test` — all 74+ tests must pass |
| **Frontend - Install** | `pnpm install --frozen-lockfile` |
| **Frontend - Build** | `pnpm build` — injects `NEXT_PUBLIC_GOOGLE_CLIENT_ID` from Jenkins credentials store |
| **Deploy Backend** | `rsync` to `/var/www/iic-app/backend/` — excludes `.env`, `venv`, `db.sqlite3`, `media` |
| **Database Migration** | `manage.py migrate --noinput` run as `iicapp` user |
| **Collect Static** | `manage.py collectstatic --noinput` |
| **Deploy Frontend** | Runs `iic-helpdesk-deploy-frontend` helper script |
| **Restart Backend** | `systemctl restart iic-helpdesk-backend.service` |
| **Restart Celery** | Restarts `iic-helpdesk-celery-worker` and `iic-helpdesk-celery-beat` |
| **Restart Frontend** | `systemctl restart iic-helpdesk-frontend.service` |
| **Health Check** | Pings `/api/v1/health/`, `redis-cli ping`, and frontend — retries 10× with 2 s delay |

---

## 19. Performance tests — k6

The `k6/` folder contains 13 test files. See `k6/README.md` for full
documentation, CSV export instructions, and a Python plotting script.

### Functional tests (run first to verify correctness)

```bash
cd k6

k6 run 01_health_public.js                                   # no auth
k6 run -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... 02_auth.js
k6 run -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... 03_tickets_requester.js
k6 run -e STAFF_EMAIL=... -e STAFF_PASSWORD=... \
       -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... 04_tickets_admin.js
k6 run -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... 05_sse_stream.js
k6 run -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... 06_notifications.js
k6 run -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... 07_admin_users.js
k6 run -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... 08_content.js
k6 run -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... 09_rate_limits.js
k6 run -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... 10_load_tickets.js
```

### Breakpoint tests (find the capacity limit)

Ramp VUs from 1 → 300 over ~10 minutes. `abortOnFail: false` means the
test runs to completion so you see the full degradation curve.

```bash
# Backend (Django/Gunicorn direct — bypass Next.js)
k6 run -e BACKEND_URL=http://127.0.0.1:8000 \
       -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... \
       11_breakpoint_backend.js

# Frontend (Next.js — tests proxy + SSE Route Handler)
k6 run -e FRONTEND_URL=http://127.0.0.1:3000 \
       -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... \
       12_breakpoint_frontend.js

# End-to-end (Cloudflare → Next.js → Django — real user path)
# Start conservatively, then increase
k6 run -e E2E_MAX_VUS=50  -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... 13_breakpoint_endtoend.js
k6 run -e E2E_MAX_VUS=300 -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... 13_breakpoint_endtoend.js
```

**SLO targets:**

| Test | p95 SLO | p99 SLO |
|------|---------|---------|
| Backend (Django) | < 500 ms | < **1 000 ms** |
| Frontend (Next.js) | < 700 ms | < **1 200 ms** |
| End-to-end | < 1 000 ms | < **2 000 ms** |

Export to CSV for plotting:

```bash
k6 run --out csv=results.csv 11_breakpoint_backend.js
```

---

## 20. API documentation

Interactive documentation available at runtime:

| URL | Tool |
|-----|------|
| `/api/v1/api/docs/` | Swagger UI (drf-spectacular) |
| `/api/v1/api/redoc/` | Redoc |
| `/api/v1/api/schema/` | Raw OpenAPI 3 schema (YAML/JSON download) |

---

## 21. Development notes

**SQLite in production** — functional but not recommended beyond ~20 concurrent
users due to write-lock contention. Migrate to PostgreSQL when going live.
The Django ORM makes this a settings-only change — no code changes required.

**Celery is required for the overdue badge** — without a running worker and
beat scheduler, `is_overdue` is never set and the badge never appears.
Start with `celery -A Project worker --beat --loglevel=info` during development.

**`proxyTimeout: 0`** in `next.config.ts` — disables the Next.js proxy
timeout entirely. Gunicorn's `timeout = 120` governs the upstream side.
This is safe with `gthread` workers because individual threads hold SSE
connections without blocking the worker process.

**`abortOnFail: false` in breakpoint tests** — intentional. The full
degradation curve is more informative than stopping at the first failure.
Plot p99 vs time from the CSV output to find the exact VU count where
performance degraded.

**Email transport** — in development the default `MAILER_BACKEND` is the
console backend which prints emails to stdout. Switch to SMTP for end-to-end
email testing. The `EmailConfiguration` DB row (configurable in Admin →
Settings) overrides `.env` without needing a server restart.

**Google OAuth** — requires the same client ID in both `GOOGLE_OAUTH_CLIENT_ID`
(backend `.env`) and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (frontend `.env.local`).
Add `http://localhost:3000` as an authorised JavaScript origin in the Google
Cloud Console for local development.
