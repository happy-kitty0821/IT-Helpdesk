<div align="center">

<img src="backend/iic-logo.png" alt="Itahari International College" height="80" />

<h1>IIC IT &amp; NOC Helpdesk</h1>

<p>
  A production-grade IT support ticket system for<br/>
  <strong>Itahari International College</strong> — built with Django 6.1 and Next.js 16
</p>

<p>
  <img src="https://img.shields.io/badge/Django-6.1.1-092E20?style=flat-square&logo=django&logoColor=white" alt="Django 6.1.1"/>
  <img src="https://img.shields.io/badge/Next.js-16.1.6-000000?style=flat-square&logo=nextdotjs&logoColor=white" alt="Next.js 16.1.6"/>
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Celery-5.5.3-37814A?style=flat-square&logo=celery&logoColor=white" alt="Celery"/>
  <img src="https://img.shields.io/badge/Redis-7.x-DC382D?style=flat-square&logo=redis&logoColor=white" alt="Redis"/>
  <img src="https://img.shields.io/badge/Cloudflare-Tunnel-F48120?style=flat-square&logo=cloudflare&logoColor=white" alt="Cloudflare"/>
</p>

<p>
  <img src="https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python"/>
  <img src="https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js"/>
  <img src="https://img.shields.io/badge/pnpm-latest-F69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm"/>
  <img src="https://img.shields.io/badge/openpyxl-3.1.5-217346?style=flat-square" alt="openpyxl"/>
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="License"/>
</p>

</div>

---

## Table of contents

<details open>
<summary>Click to expand</summary>

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
17. [Deployment — Linux](#17-deployment--linux)
18. [Deployment — Windows](#18-deployment--windows)
19. [CI/CD — Jenkins](#19-cicd--jenkins)
20. [Performance tests — k6](#20-performance-tests--k6)
21. [API documentation](#21-api-documentation)
22. [Development notes](#22-development-notes)

</details>

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
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SERVER (Linux LXC / Windows)                        │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  cloudflared  (tunnel daemon)  →  Next.js :3000                      │  │
│  └───────────────────────────┬──────────────────────────────────────────┘  │
│                               │                                             │
│  ┌────────────────────────────▼─────────────────────────────────────────┐  │
│  │  Next.js 16  (App Router · pnpm · port 3000)                        │  │
│  │  Static pages  ·  API proxy rewrites  ·  SSE Route Handlers          │  │
│  └────────────────────────────┬─────────────────────────────────────────┘  │
│                               │  HTTP/1.1 (localhost)                       │
│  ┌────────────────────────────▼─────────────────────────────────────────┐  │
│  │  Django 6.1  +  Gunicorn gthread (Linux) / Waitress (Windows)        │  │
│  │  port 8000  ·  DRF REST API  ·  SSE StreamingHttpResponse            │  │
│  └───────┬──────────────────────────────────────┬────────────────────-─┘   │
│           │  Django ORM                           │  redis-py               │
│           ▼                                       ▼                        │
│  ┌──────────────────┐              ┌──────────────────────────────────┐    │
│  │  SQLite (dev)    │              │  Redis  :6379                    │    │
│  │  PostgreSQL (prod│              │  Celery broker + result backend  │    │
│  └──────────────────┘              └──────────┬───────────────────────┘    │
│                                               ▼                            │
│                              ┌───────────────────────────────────────┐     │
│                              │  Celery workers + beat scheduler       │     │
│                              │  SLA alerts · auto-close · outbox      │     │
│                              └───────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────┘
```

<details>
<summary>SSE routing detail</summary>

```
Browser  GET /api/v1/tickets/{id}/stream/
              │
    Next.js routing phases (in order):
              │
    1. beforeFiles rewrites  ── (none match)
    2. Filesystem pages      ── (none match)
    3. afterFiles rewrites   ── tickets/:path* NOT here → skip  ◄── key
    4. App Router handler    ── app/api/v1/tickets/[id]/stream/route.ts ✓
    5. fallback rewrites     ── tickets/:path* here (other API calls)
```

SSE handlers live in `fallback` phase so App Router Route Handlers execute
first, bypassing the proxy buffer that would otherwise starve SSE streams.

</details>

---

## 2. Feature overview

### Student / public portal

| Feature | Detail |
|---------|--------|
| 🎫 Ticket submission | Dynamic form fields per service category |
| 📡 Real-time updates | SSE — status, assignee, stage update without page refresh |
| ⚠️ Overdue badge | Red chip when ticket breaches SLA threshold |
| 💬 Message thread | Two-way conversation with IT staff; internal notes hidden |
| 🔁 Ticket reopen | Closed tickets re-openable within 7 days |
| ⭐ Satisfaction feedback | 1–5 star rating + comment after resolution |
| 🔑 Account recovery | Dedicated workflow with credentials email |
| 🔐 Authentication | Email/password + Google Workspace SSO |
| 📚 Self-service | PDF guides, software catalogue, service status board |

### Staff admin panel (`/admin`)

| Feature | Detail |
|---------|--------|
| 🗂️ Live ticket queue | Filterable, searchable, debounced search (600 ms), paginated |
| 🔒 State machine | Enforced transitions — illegal moves rejected with clear error |
| 👤 Intern self-assign | IT NOC interns take ownership within scoped categories |
| 🏥 Account recovery | Send credentials; auto-resolves ticket + completes stages |
| 📊 Analytics dashboard | SSE-powered KPI cards, charts, recent tickets |
| 📤 Excel export | 5-sheet audit workbook with 8 charts (§16) |
| 🔔 Notifications | Discord · Teams · Slack · SMTP · Mailgun channels + routing rules |
| 👥 User management | Grant/revoke roles, suspend/unsuspend, set superuser |
| 🛡️ Rate limiting | DB-configurable rules with violation tracking |
| 📋 Reports | KPI snapshot + filtered export (admin → Reports) |
| 📝 Content management | PDF guides, software catalogue, announcements |
| 🌐 Service status board | Per-category operational status |
| ⚙️ Site settings | Office hours, email, upload config, file scanning |
| 🔍 Attachment scanning | Magic-bytes check + optional VirusTotal integration |

---

## 3. Tech stack

<table>
<thead>
<tr><th>Layer</th><th>Technology</th><th>Version</th></tr>
</thead>
<tbody>
<tr><td>Backend framework</td><td>Django</td><td>6.1.1</td></tr>
<tr><td>REST API</td><td>Django REST Framework</td><td>3.18.1</td></tr>
<tr><td>WSGI server (Linux)</td><td>Gunicorn (gthread workers)</td><td>23.0.0</td></tr>
<tr><td>WSGI server (Windows)</td><td>Waitress</td><td>3.0.2</td></tr>
<tr><td>Task queue</td><td>Celery + Redis</td><td>5.5.3 / 5.2.1</td></tr>
<tr><td>Frontend framework</td><td>Next.js (App Router)</td><td>16.1.6</td></tr>
<tr><td>Frontend language</td><td>TypeScript + React</td><td>5.9 / 19.2.3</td></tr>
<tr><td>Animation</td><td>Motion (Framer Motion v12)</td><td>12.x</td></tr>
<tr><td>Icons</td><td>Lucide React</td><td>0.468+</td></tr>
<tr><td>Excel export</td><td>openpyxl</td><td>3.1.5</td></tr>
<tr><td>API schema</td><td>drf-spectacular</td><td>0.30.0</td></tr>
<tr><td>DB URL parsing</td><td>dj-database-url</td><td>2.3.0</td></tr>
<tr><td>Package manager (FE)</td><td>pnpm</td><td>latest</td></tr>
<tr><td>Database (dev)</td><td>SQLite</td><td>built-in</td></tr>
<tr><td>Database (prod)</td><td>PostgreSQL (recommended)</td><td>14+</td></tr>
<tr><td>Tunnel</td><td>Cloudflare Tunnel (cloudflared)</td><td>latest</td></tr>
<tr><td>CI/CD</td><td>Jenkins</td><td>—</td></tr>
<tr><td>Windows services</td><td>NSSM</td><td>2.24+</td></tr>
<tr><td>Performance tests</td><td>k6</td><td>0.54+</td></tr>
</tbody>
</table>

---

## 4. Project structure

```
IIC-IT Helpdesk/
│
├── backend/
│   ├── helpdesk/                     ← Django app (all business logic)
│   │   ├── management/commands/
│   │   │   ├── bootstrap_admin.py    ← Create/update initial admin account
│   │   │   └── seed_rate_limits.py   ← Seed default rate-limit rules
│   │   ├── migrations/               ← 45+ schema + data migrations
│   │   ├── templates/email/          ← Branded HTML email templates
│   │   ├── models.py                 ← All data models
│   │   ├── views.py                  ← All API + SSE views + Excel export
│   │   ├── serializers.py            ← DRF serializers (incl. state machine)
│   │   ├── signals.py                ← Post-save triggers (notifications)
│   │   ├── tasks.py                  ← Celery tasks (SLA, auto-close, outbox)
│   │   ├── notifications.py          ← Channel dispatch + webhook formatting
│   │   ├── email_dispatch.py         ← Unified email sender
│   │   ├── email_config_service.py   ← Transport resolution (DB → env fallback)
│   │   ├── permissions.py            ← DRF permissions + role helpers
│   │   ├── throttling.py             ← DB-driven rate limiting engine
│   │   └── urls.py                   ← All URL patterns
│   ├── Project/
│   │   ├── celery.py                 ← Celery app + beat schedule
│   │   ├── settings.py               ← Django settings (dj-database-url)
│   │   └── urls.py
│   ├── gunicorn.conf.py              ← Gunicorn config (Linux)
│   ├── requirements.txt              ← OS-conditional deps (gunicorn/waitress)
│   └── .env.example
│
├── frontend/
│   ├── app/
│   │   ├── admin/                    ← All staff management pages
│   │   │   ├── tickets/              ← Live queue (SSE, debounced search)
│   │   │   ├── notifications/        ← Dashboard + channels + templates
│   │   │   ├── reports/              ← KPI snapshot + export
│   │   │   └── settings/             ← Ticket form, contact, uploads, scanning
│   │   ├── tickets/[id]/             ← Ticket detail + SSE + reopen
│   │   └── api/v1/                   ← Next.js Route Handlers (SSE + uploads)
│   ├── components/
│   │   ├── site-header.tsx
│   │   └── admin-shell.tsx           ← Sidebar nav + role-gated items
│   ├── hooks/
│   │   └── use-ticket-stream.ts      ← EventSource hook (auto-reconnect)
│   ├── lib/
│   │   ├── auth.ts                   ← AuthUser type + role helpers
│   │   └── admin-api.ts              ← Admin API helpers + types
│   └── next.config.ts                ← Rewrites, proxyTimeout, SSE headers
│
├── k6/                               ← 13 performance + functional test files
├── deploy/
│   ├── linux/
│   │   ├── iic-helpdesk-backend.service     ← systemd: Django/Gunicorn
│   │   ├── iic-helpdesk-celery-worker.service ← systemd: Celery worker
│   │   ├── iic-helpdesk-celery-beat.service  ← systemd: Celery beat
│   │   ├── iic-helpdesk-frontend.service     ← systemd: Next.js
│   │   └── README.md                         ← Linux install guide
│   ├── windows/
│   │   ├── windows-deploy.ps1               ← Windows deployment script (NSSM)
│   │   └── README.md                        ← Windows service documentation
│   └── README.md                            ← Deployment method overview
│
├── cloudflared-config.yml            ← Tunnel config
├── Jenkinsfile                       ← CI/CD pipeline
└── README.md
```

---

## 5. Local development

### Prerequisites

<table>
<thead><tr><th>Tool</th><th>Version</th><th>Notes</th></tr></thead>
<tbody>
<tr><td>Python</td><td>3.11+</td><td>Required</td></tr>
<tr><td>Node.js</td><td>20+</td><td>Required</td></tr>
<tr><td>pnpm</td><td>latest</td><td><code>npm install -g pnpm</code></td></tr>
<tr><td>Redis</td><td>7.x</td><td>Optional — only needed for Celery/SLA</td></tr>
</tbody>
</table>

### Step-by-step

```bash
# ── Backend ───────────────────────────────────────────────────────────────────

cd backend
python -m venv venv
source venv/bin/activate          # Linux/macOS
# venv\Scripts\Activate.ps1       # Windows PowerShell

pip install -r requirements.txt
cp .env.example .env              # Edit .env with your values

python manage.py migrate
python manage.py bootstrap_admin --password "YourPassword123!"
python manage.py seed_rate_limits

# ── Frontend ──────────────────────────────────────────────────────────────────

cd ../frontend
cp .env.example .env.local        # Edit .env.local
pnpm install

# ── Start (three terminals) ───────────────────────────────────────────────────

# Terminal 1 — Django
cd backend && python manage.py runserver 127.0.0.1:8000

# Terminal 2 — Next.js
cd frontend && pnpm dev

# Terminal 3 — Celery (optional, for SLA overdue badge)
cd backend && celery -A Project worker --beat --loglevel=info
```

Open **http://localhost:3000**

---

## 6. Environment variables

<details>
<summary><strong>Backend — backend/.env</strong></summary>

| Variable | Description | Default |
|----------|-------------|---------|
| `DJANGO_SECRET_KEY` | Long random key — required in production | insecure dev key |
| `DJANGO_DEBUG` | Enable debug mode | `true` |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated allowed hosts | `localhost,127.0.0.1` |
| `ALLOWED_REGISTRATION_DOMAINS` | Email domains permitted to self-register | `iic.edu.np` |
| `CSRF_TRUSTED_ORIGINS` | Origins allowed to send CSRF-protected requests | `http://localhost:3000` |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth 2.0 Web client ID | — |
| `HELPDESK_URL` | Public frontend URL (used in outgoing emails) | `http://localhost:3000` |
| `DATABASE_URL` | DB connection string (blank = SQLite) | — |
| `REDIS_URL` | Redis URL for Celery broker | `redis://127.0.0.1:6379/0` |
| `MAILER_BACKEND` | Django mail backend class | console backend |
| `MAILER_HOST` | SMTP hostname | `localhost` |
| `MAILER_PORT` | SMTP port | `587` |
| `MAILER_USE_TLS` | Enable STARTTLS | `true` |
| `MAILER_USERNAME` | SMTP username | — |
| `MAILER_PASSWORD` | SMTP app password | — |
| `VERIFICATION_FROM_EMAIL` | From address for system emails | `noreply@iic.edu.np` |
| `EMAIL_VERIFICATION_ENABLED` | Require email verification on signup | `true` |
| `VIRUSTOTAL_API_KEY` | VirusTotal API key (optional) | — |
| `SLA_SUBMITTED_HOURS` | Hours before submitted ticket is overdue | `2` |
| `SLA_TRIAGED_HOURS` | Hours before triaged ticket is overdue | `4` |
| `SLA_IN_PROGRESS_HOURS` | Hours before in-progress ticket is overdue | `24` |
| `SLA_WAITING_REQUESTER_HOURS` | Hours before waiting ticket is overdue | `48` |
| `SLA_ESCALATION_MULTIPLIER` | Escalation threshold = first × this | `2.0` |
| `SLA_ALERT_COOLDOWN_HOURS` | Min hours between repeated alerts | `4` |
| `MEDIA_ACCEL_REDIRECT` | Use Nginx X-Accel-Redirect for media (prod) | `false` |

</details>

<details>
<summary><strong>Frontend — frontend/.env.local</strong></summary>

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth client ID (same as backend) |
| `NEXT_PUBLIC_DJANGO_URL` | Public Django URL for browser-side SSE fallback |
| `NEXT_PUBLIC_SITE_URL` | Canonical public URL |
| `DJANGO_INTERNAL_URL` | Internal Django URL for server-side fetches |

</details>

---

## 7. Management commands

All commands run from `backend/` with the virtual environment active.

### `bootstrap_admin`

Creates or updates the initial administrator account. Safe to run multiple times.

```bash
python manage.py bootstrap_admin \
  --username aayush.limbu \
  --email    aayush.limbu@iic.edu.np \
  --password "YourSecurePassword123!"
```

Password can also be supplied via `INITIAL_ADMIN_PASSWORD` environment variable (recommended for CI).

### `seed_rate_limits`

Idempotently creates default `RateLimitRule` rows (`get_or_create` — existing rules are never overwritten).

```bash
python manage.py seed_rate_limits
```

<details>
<summary>Default rules created</summary>

| Scope | Limit | Window | Action |
|-------|-------|--------|--------|
| `auth_login` | 10 | minute | block |
| `auth_register` | 5 | hour | block |
| `auth_google` | 10 | minute | block |
| `ticket_create` | 20 | hour | block |
| `ticket_message` | 60 | hour | warn + log |
| `ticket_status` | 30 | hour | block |
| `public_api` | 120 | minute | block |
| `admin_user_write` | 60 | hour | block |
| `admin_bulk` | 120 | hour | warn + log |
| `export` | 5 | hour | block |
| `change_password` | 5 | hour | block |

</details>

### Standard Django commands

```bash
python manage.py migrate                          # Apply migrations
python manage.py makemigrations helpdesk --name "describe_change"
python manage.py showmigrations helpdesk          # Migration status
python manage.py test helpdesk --verbosity=2      # Run tests
python manage.py check                            # Config validation
python manage.py collectstatic --noinput          # Production static files
python manage.py shell                            # Django REPL
```

---

## 8. Database migrations

```bash
python manage.py migrate                                  # Apply all
python manage.py makemigrations helpdesk --name "..."    # Create new
python manage.py showmigrations helpdesk                  # Check status
```

<details>
<summary>Notable migrations</summary>

| Migration | What it adds |
|-----------|-------------|
| `0001_initial` | Base schema: User, Ticket, ServiceCategory |
| `0005_role_system` | RoleGrant, RoleAuditEvent, InternCategoryScope |
| `0007_service_form_schema` | Dynamic form fields per category |
| `0010_notification_channels` | NotificationChannel, EmailTemplate |
| `0019_rate_limiting` | RateLimitRule, RateLimitViolation |
| `0028_site_settings` | SiteSettings singleton |
| `0037_add_overdue_fields` | `is_overdue`, `last_stale_alert_at` on Ticket |
| `0040_seed_email_templates` | Default HTML email templates (all event types) |
| `0043_add_file_scan_settings` | FileScanSettings + attachment scan state |
| `0045_add_attachment_scan_log` | AttachmentScanLog audit table |

</details>

---

## 9. Authentication

| Method | Endpoint | Notes |
|--------|----------|-------|
| Email / username + password | `POST /api/v1/auth/login/` | Both identifiers accepted |
| Google Workspace SSO | `POST /api/v1/auth/google/` | Verifies token, domain, audience |
| Logout | `POST /api/v1/auth/logout/` | Clears session |
| Current user | `GET /api/v1/auth/me/` | Returns roles, profile |
| Email verification | `POST /api/v1/auth/verify-email/` | Required after registration |
| Forgot password | `POST /api/v1/auth/forgot-password/` | Always returns 200 (no enumeration) |
| Reset password | `POST /api/v1/auth/reset-password/` | Consumes single-use token |
| Change password | `POST /api/v1/auth/change-password/` | Requires current password |
| Profile | `GET / PATCH /api/v1/auth/profile/` | Name, programme, department |

Sessions use `SameSite=Lax` cookies. CSRF tokens required on all write operations — `GET /api/v1/auth/csrf/` returns the token.

---

## 10. Role system

Roles are stored in `RoleGrant` rows (not Django groups). Each grant has an optional expiry date. All changes are immutably logged in `RoleAuditEvent`.

| Role | Access level |
|------|-------------|
| `administrator` | Full access + user management + superuser |
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

```
submitted ──► triaged ──► in_progress ──► waiting_requester
    │             │             │                │
    ▼             ▼             ▼                ▼
cancelled     cancelled  waiting_approval     resolved ──► closed
                               │                │
                               ▼                └──► in_progress (reopen within 7 days)
                            resolved
```

- Transitions enforced in `TicketUpdateSerializer.validate_status` (PATCH) and `TicketStatusView` (POST)
- Invalid moves return HTTP 400 with a structured error (`code: invalid_transition`)
- Frontend renders only valid next states for the caller's role
- Requesters can: cancel (submitted/triaged), close (resolved), reopen (closed, within 7 days)

---

## 12. SLA alerting — Celery

The `check_stale_tickets` beat task runs **every 15 minutes**:

1. Scans tickets in `submitted`, `triaged`, `in_progress`, `waiting_requester`
2. Compares age against the per-status SLA threshold
3. Sets `ticket.is_overdue = True` → sends `ticket_stale` notification to assignee
4. Escalates (cc's service leads/admins) at **2× the first threshold**
5. Clears `is_overdue` when staff takes action

The ⚠️ **Overdue** badge appears in the admin queue and ticket panel, updated live via SSE.

```bash
# Development (worker + beat in one process)
celery -A Project worker --beat --loglevel=info

# Production (separate processes / services)
celery -A Project worker --loglevel=info    # iic-helpdesk-celery-worker
celery -A Project beat   --loglevel=info    # iic-helpdesk-celery-beat
```

**Additional beat tasks:**

| Task | Schedule | Purpose |
|------|----------|---------|
| `auto_close_resolved_tickets` | Every hour | Close tickets resolved 7+ days ago |
| `deliver_notification_outbox` | Every 2 min | Retry failed notification sends |

---

## 13. Email system

All outgoing email routes through `helpdesk/email_dispatch.py`:
`resolve_and_send(event_type, context, to_email)`.

**Transport precedence (highest → lowest):**

```
1. NotificationChannel (email_smtp / email_mailgun) matching event_type rule
         ↓
2. Active EmailConfiguration DB row
         ↓
3. .env MAILER_* variables  (always-available fallback)
```

**Template precedence:**

```
1. Active EmailTemplate DB row  (Admin → Notifications → Templates)
         ↓  (if none, or use_file_fallback = True)
2. On-disk HTML file  (helpdesk/templates/email/{event_type}.html)
```

<details>
<summary>Supported event types (13 total)</summary>

| Event | When sent |
|-------|-----------|
| `ticket_submitted` | New ticket created |
| `ticket_resolved` | Ticket moved to resolved |
| `ticket_assigned` | Ticket assigned or reassigned |
| `ticket_reply` | Staff reply sent |
| `status_changed` | Any status transition |
| `waiting_requester` | Ticket moved to waiting_requester |
| `priority_changed` | Priority escalated by requester |
| `account_recovery` | Credentials email sent |
| `recovery_unable_to_verify` | Identity could not be verified |
| `ticket_stale` | SLA breach alert |
| `email_verification` | Account registration verification link |
| `password_reset` | Password reset link |
| `attachment_scan_failed` | Infected file detected |

</details>

---

## 14. SSE real-time updates

Two streaming endpoints, served by **Next.js Route Handlers** (not the rewrite proxy) to avoid response-body buffering:

| Endpoint | Used by |
|----------|---------|
| `/api/v1/tickets/{id}/stream/` | Student ticket page + admin panel |
| `/api/v1/admin/summary/stream/` | Admin dashboard KPIs |

> **Why Route Handlers?** The Next.js rewrite proxy buffers response bodies.
> For infinite SSE streams this means the browser receives headers but zero bytes.
> Route Handlers return `upstream.body` (a `ReadableStream`) directly, bypassing the buffer.

---

## 15. File uploads

Large files use a **three-step chunked upload** (bypasses Cloudflare's 100 MB body limit):

```
POST  /api/v1/upload/init/                     Create upload session
PUT   /api/v1/upload/{id}/chunk/{index}/        Upload each chunk (default 2 MB)
POST  /api/v1/upload/{id}/finalize/             Reassemble + attach to ticket
```

Each chunk is a separate HTTP request, handled by Next.js Route Handlers (not rewrites — the proxy drops multipart PUT bodies).

**Scan pipeline** (runs after finalize, via Celery):

```
Magic-bytes check (local, ~1ms)
         ↓  pass
VirusTotal scan (async, ~15–75s) — if enabled
         ↓  clean
scan_state = clean  →  staff can download
         ↓  infected
scan_state = infected  →  alert email sent  →  file blocked (if auto_block_infected=True)
```

---

## 16. Excel report export

`GET /api/v1/tickets/export/` returns a **5-sheet `.xlsx` workbook**:

| Sheet | Contents |
|-------|----------|
| **1 — Ticket Register** | One row per ticket: all fields, SLA bucket, first-response time, reopen count, satisfaction score |
| **2 — Analytics Summary** | KPI cards + 8 embedded charts: status pie, priority pie, category bar, avg resolution by category, SLA distribution, assignee workload, satisfaction distribution, day-of-week volume, monthly trend |
| **3 — Ticket Audit Trail** | Every `TicketEvent` across exported tickets — actor, action, from/to, note, timestamp |
| **4 — Role Audit Events** | All `RoleAuditEvent` rows — role grants and revocations, actor, target, department |
| **5 — Satisfaction Feedback** | One row per feedback submission: ticket ref, category, rating (1–5), comment, submitted date |

**Query parameters:**

```
?from=2026-01-01   ISO date, inclusive
?to=2026-12-31     ISO date, inclusive
?status=resolved   comma-separated status values
?priority=p1,p2    comma-separated priority values
```

---

## 17. Deployment — Linux

See `deploy/linux/README.md` for detailed server config. Quick reference:

```bash
# 1. Cloudflare Tunnel
sudo cp cloudflared-config.yml /etc/cloudflared/config.yml
# Edit: fill in tunnel ID + credentials path
sudo systemctl enable --now cloudflared

# 2. Backend
cd /var/www/iic-app/backend
cp .env.example .env && nano .env
pip install -r requirements.txt
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py bootstrap_admin --password "..."
sudo systemctl enable --now iic-helpdesk-backend

# 3. Celery
sudo systemctl enable --now iic-helpdesk-celery-worker
sudo systemctl enable --now iic-helpdesk-celery-beat

# 4. Frontend
cd /var/www/iic-app/frontend
pnpm install --frozen-lockfile && pnpm build
sudo systemctl enable --now iic-helpdesk-frontend
```

---

## 18. Deployment — Windows

Windows uses **NSSM** (Non-Sucking Service Manager) and **Waitress** instead of systemd + Gunicorn.

```powershell
# Run as Administrator
Set-Location "C:\iic-helpdesk"
Copy-Item backend\.env.example backend\.env
notepad backend\.env                         # Fill in values

.\deploy\windows\windows-deploy.ps1                  # Full deploy
.\deploy\windows\windows-deploy.ps1 -SkipBuild       # Backend-only re-deploy
.\deploy\windows\windows-deploy.ps1 -SkipTests       # Skip test run
.\deploy\windows\windows-deploy.ps1 -Uninstall       # Remove all services
```

**Services registered:**

| Service | Process | Port |
|---------|---------|------|
| `iic-helpdesk-backend` | Django via Waitress | 8000 |
| `iic-helpdesk-celery-worker` | Celery task worker | — |
| `iic-helpdesk-celery-beat` | Celery beat scheduler | — |
| `iic-helpdesk-frontend` | Next.js production | 3000 |

```powershell
Get-Service iic-helpdesk-*          # Check status
Get-Content logs\backend-stdout.log -Tail 50   # View logs
```

See `deploy/windows/README.md` for full documentation.

---

## 19. CI/CD — Jenkins

The `Jenkinsfile` at the repo root defines the full Linux deployment pipeline.

<details>
<summary>Pipeline stages</summary>

| Stage | What happens |
|-------|-------------|
| **Infrastructure - Redis** | `redis-cli ping` — fails build if Redis is unavailable |
| **Backend - Install** | `pip install -r requirements.txt` in the venv |
| **Backend - Validate** | `manage.py check` — zero issues required |
| **Backend - Tests** | `manage.py test` — all tests must pass |
| **Frontend - Install** | `pnpm install --frozen-lockfile` |
| **Frontend - Build** | `pnpm build` — injects Google client ID from Jenkins credentials |
| **Deploy Backend** | `rsync` to `/var/www/iic-app/backend/` — excludes `.env`, `venv`, `db.sqlite3`, `media` |
| **Database Migration** | `manage.py migrate --noinput` as `iicapp` user |
| **Collect Static** | `manage.py collectstatic --noinput` |
| **Deploy Frontend** | Runs `iic-helpdesk-deploy-frontend` helper script |
| **Restart Backend** | `systemctl restart iic-helpdesk-backend.service` |
| **Restart Celery** | Restarts worker + beat services |
| **Restart Frontend** | `systemctl restart iic-helpdesk-frontend.service` |
| **Health Check** | Pings `/api/v1/health/` + Redis + frontend (10 retries, 2 s apart) |

</details>

---

## 20. Performance tests — k6

The `k6/` folder contains **13 test files**. See `k6/README.md` for full documentation, CSV export instructions, and a Python plotting script.

### Functional tests

```bash
cd k6
k6 run 01_health_public.js
k6 run -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... 02_auth.js
k6 run -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... 03_tickets_requester.js
k6 run -e STAFF_EMAIL=...   -e STAFF_PASSWORD=...   \
       -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... 04_tickets_admin.js
k6 run -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... 05_sse_stream.js
k6 run -e ADMIN_EMAIL=...   -e ADMIN_PASSWORD=...   06_notifications.js
k6 run -e ADMIN_EMAIL=...   -e ADMIN_PASSWORD=...   09_rate_limits.js
```

### Breakpoint tests

```bash
# Django backend (direct, bypasses Next.js)
k6 run -e BACKEND_URL=http://127.0.0.1:8000 \
       -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... 11_breakpoint_backend.js

# Next.js frontend
k6 run -e FRONTEND_URL=http://127.0.0.1:3000 \
       -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... 12_breakpoint_frontend.js

# Full end-to-end (Cloudflare → Next.js → Django)
k6 run -e E2E_MAX_VUS=300 \
       -e STUDENT_EMAIL=... -e STUDENT_PASSWORD=... 13_breakpoint_endtoend.js
```

**SLO targets:**

| Test | p95 | p99 |
|------|-----|-----|
| Backend (Django) | < 500 ms | < 1 000 ms |
| Frontend (Next.js) | < 700 ms | < 1 200 ms |
| End-to-end | < 1 000 ms | < 2 000 ms |

---

## 21. API documentation

| URL | Tool |
|-----|------|
| `/api/v1/api/docs/` | Swagger UI (drf-spectacular) |
| `/api/v1/api/redoc/` | Redoc |
| `/api/v1/api/schema/` | Raw OpenAPI 3 schema download |

---

## 22. Development notes

<details>
<summary>Click to expand</summary>

**SQLite in production** — functional but not recommended beyond ~20 concurrent users due to write-lock contention. Set `DATABASE_URL=postgres://...` in `.env` to switch engines — no code changes required, just a `pip install psycopg2-binary` and re-migrate.

**Celery is required for the overdue badge** — without a running worker and beat scheduler, `is_overdue` is never set and the badge never appears. Start with `celery -A Project worker --beat --loglevel=info` in development.

**`proxyTimeout: 0` in `next.config.ts`** — disables the Next.js proxy timeout. Gunicorn's `timeout = 120` governs the upstream side. Safe with `gthread` workers because individual threads hold SSE connections without blocking the worker process.

**Google OAuth** — requires the same client ID in both `GOOGLE_OAUTH_CLIENT_ID` (backend `.env`) and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (frontend `.env.local`). Add `http://localhost:3000` as an authorised JavaScript origin in the Google Cloud Console for local development.

**Email in development** — the default `MAILER_BACKEND` is the console backend, which prints emails to stdout. Switch to SMTP for end-to-end email testing. The `EmailConfiguration` DB row (Admin → Settings) overrides `.env` without needing a server restart.

**OS-conditional WSGI server** — `requirements.txt` uses PEP 508 markers: `gunicorn` installs on Linux/macOS, `waitress` on Windows. No manual editing needed when switching environments.

**`abortOnFail: false` in breakpoint tests** — intentional. The full degradation curve is more informative than stopping at the first failure. Plot p99 vs VU count from the CSV output to find the exact capacity limit.

</details>

---

<div align="center">

<p>
  Built with ❤️ for <strong>Itahari International College — IT &amp; NOC Department</strong>
</p>

<p>
  <img src="https://img.shields.io/badge/Made%20in-Nepal%20🇳🇵-blue?style=flat-square" alt="Made in Nepal"/>
  <img src="https://img.shields.io/badge/Stack-Django%20+%20Next.js-234395?style=flat-square" alt="Stack"/>
</p>

</div>
