# IIC IT & NOC Helpdesk — Project Specification

**Institution:** Itahari International College (IIC), ING  
**Requested stack:** Django REST Framework backend + Next.js frontend  
**Version:** 1.0 — planning baseline  
**Prepared:** 10 September 2026  
**Status:** Proposed implementation requirements; institutional policies and brand values require validation.

## 1. Purpose and scope

Build an independent IIC support application where students and employees find help, submit requests, follow progress, and access approved software resources. Give the IT & NOC team a single workspace for triage, assignments, communication, approvals, and service reporting.

This document is the deliverable; it does not claim that the application has been implemented. Website content and the supplied logo are reference material, not instructions or authorization. All requirements below are proposed for IIC unless explicitly labelled as observed.

**Launch scope:** public help centre, institutional sign-in, six request categories, ticket management, restricted approvals, guides, software catalogue, announcements, service status, notifications, administration, and basic reports. Build a modular monolith for one college. Do not introduce multi-college tenancy at launch.

**Later scope:** inventory and loan management, appointment scheduling, inbound email tickets, monitoring integrations, Nepali translations, satisfaction analytics, and richer reports.

**Excluded:** student information system replacement, fee collection, automatic account password resets, CCTV streaming, remote device control, unofficial software distribution, AI chatbots, native mobile apps, and reproducing the other colleges' private systems.

## 2. Reference-site inspection and evidence

Inspection was limited to publicly rendered homepages, visible links, and browser presentation. No forms were submitted, accounts accessed, protected libraries downloaded, or backend behaviour tested. Linked form fields and PDF contents were not audited. Absence from a homepage is not evidence that a feature does not exist elsewhere.

| Reference | Verified public observations | IIC design implication |
|---|---|---|
| [Islington IT Desk](https://itdesk.islingtoncollege.edu.np/) | Request links cover email recovery, laptop drop-off, ID replacement, CCTV review, and Wi-Fi feedback. A restricted Drive library, account guides, and installation PDFs are listed. Google Drive and OneDrive/M365 selectors, an operational label, contact details, and an announcement overlay are present. | Keep clear service cards, resource discovery, and help contacts. Replace scattered intake links with IIC-owned workflows where appropriate. |
| [Herald IT Support](https://itsupport.heraldcollege.edu.np/) | Requests cover email recovery, ID replacement, Wi-Fi, and staff-only CCTV review. Seven installation guides are listed. A light/dark switch, Wi-Fi advice overlay, dark green-accented hero, and network diagram labelled live are visible. The footer provides a walk-in location and email. | Adopt readable hierarchy, optional themes, and helpful guidance. Enforce restricted services in the backend. Do not claim live monitoring without an actual data source. |

Herald initially failed in the text retrieval tool but was successfully inspected in the browser. Neither homepage established an authenticated ticket portal, assignment workflow, SLA engine, or reporting system; those are proposed IIC additions. Source labels such as “live” and “operational” were observed, not independently verified.

### 2.1 Content migration rules

- Create IIC-owned service descriptions, contacts, locations, and forms; never retain another college's submission destination by accident.
- Inventory approved resources with title, owner, destination, audience, licence conditions, operating system, version, and review date.
- Link or reproduce materials only with appropriate permission. Audit actual guide contents before publication.
- Use vendor-authorized software sources and approved institutional storage. Do not publish shared licence keys.
- Have IIC content owners validate all links and procedures in staging before launch.

## 3. Users, roles, and access

| Role | Allowed capabilities | Restrictions |
|---|---|---|
| Visitor | Public guides, status, contacts, recovery intake | No ticket listings or restricted downloads |
| Student | Submit permitted requests, view own tickets, reply, download eligible resources | No staff-only CCTV submission or other users' tickets |
| Faculty/staff | Student-equivalent capabilities plus eligible staff services | Access determined by verified institutional role |
| IT agent | Work assigned/team queues, public replies, internal notes, diagnosis | Sensitive cases require explicit membership; no role administration |
| Service lead | Triage, assignment, escalation, team reports, category configuration | Cannot approve their own sensitive request |
| Designated approver | Review assigned ID/CCTV approval tasks | Only relevant case data; no unrestricted queue access |
| Content editor | Draft, revise, publish approved guides and announcements | No requester records by default |
| Administrator | Manage users, roles, settings, integrations | Sensitive content access remains explicit and audited |

Backend authorization is mandatory for lists, details, search, exports, files, and every mutation. Hiding controls in Next.js is insufficient. A user may hold several roles; assignment and approval rules still apply. Deactivated users lose sessions and future access while historical authorship remains attributable under retention policy.

## 4. Functional requirements

Priority key: **M** = mandatory launch requirement; **L** = later enhancement. Acceptance statements describe required behaviour, not completed tests.

| ID | Priority | Requirement and acceptance condition |
|---|---|---|
| FR-01 | M | Public landing page presents service cards, searchable help, service status, notices, hours, and contact route. A visitor can find each launch service within two navigation actions. |
| FR-02 | M | Sign in through the approved institutional identity provider. Validate identity server-side; approved domains and roster mappings are configurable. Never infer staff privileges solely from an email address. |
| FR-03 | M | Provide an accessible recovery route without requiring access to the locked college account. Intake returns a generic receipt; staff verify identity using an approved procedure before action. |
| FR-04 | M | Category-specific forms support required/optional fields, validation, review before submission, and server-generated reference numbers. Repeated submission with the same idempotency key creates one ticket. |
| FR-05 | M | Requesters see only their tickets, status history, public replies, permitted attachments, and next actions. Search and pagination preserve these restrictions. |
| FR-06 | M | Agents filter queues by category, status, priority, assignee, age, and due date. Assignment changes and overrides record actor, time, and reason. |
| FR-07 | M | Ticket conversations distinguish public replies and internal notes. Internal notes never appear in requester APIs, notifications, exports, or attachments. |
| FR-08 | M | Enforce ticket transitions in Django, including required resolution text, approval gates, cancellation rules, and reopening. Invalid transitions return a structured error. |
| FR-09 | M | Sensitive requests enter a restricted queue and approval workflow. Submission alone never authorizes release of footage or identity changes. |
| FR-10 | M | Guides support category, audience, tags, search, draft/published/archive states, revisions, review dates, accessible HTML, and optional PDFs. Unpublished content is not public. |
| FR-11 | M | Software catalogue supports OS, architecture, version, eligibility, instructions, licence notes, and approved download links. Restricted assets require authorization on every access. |
| FR-12 | M | Announcements support audience, scheduled start/end, priority, owner, accessible body, and dismissal. Routine notices use banners instead of blocking the homepage. |
| FR-13 | M | Service status supports operational, degraded, outage, maintenance, and unknown states per service, incident updates, and last-updated time. Stale data becomes unknown after a configured threshold. |
| FR-14 | M | Send in-app and email notifications for receipts, public replies, assignment, approval, resolution, and SLA escalation. Deduplicate and retry failures; never include internal notes or sensitive evidence. |
| FR-15 | M | Administrators manage categories, buildings/rooms, hours, holidays, routing, templates, and retention settings. Existing tickets retain their historical category/schema meaning. |
| FR-16 | M | Reports show volume, backlog, response time, resolution time, SLA breaches, category and assignment breakdowns. CSV export obeys permissions and neutralizes spreadsheet formula injection. |
| FR-17 | M | Immutable application audit events record role changes, sensitive reads/downloads, transitions, approval decisions, exports, and publication changes without storing secrets. |
| FR-18 | M | All pages include appropriate loading, empty, validation, unauthorized, not-found, offline/network error, and retry states. Failed sends preserve unsent form content in memory. |
| FR-19 | L | Collect one optional satisfaction response per resolved ticket and report aggregates without exposing private comments broadly. |
| FR-20 | L | Add device inventory, appointment slots, inbound email threading, and monitoring webhooks as separately authorized modules. |

### 4.1 Launch service forms

Common authenticated fields: verified requester identity, category, subject (5–150 characters), description (20–5,000 characters), affected location where relevant, impact, and optional attachments. Phone number is optional unless a category demonstrably needs it. Identity, role, timestamps, status, and assignee are server-controlled.

| Service | Additional fields | Workflow and completion evidence |
|---|---|---|
| College account recovery | College email, college ID, alternative contact, issue type | Restricted intake → identity verification → authorized staff recovery procedure → confirmation. Never ask for a password, OTP, recovery code, or secret answer. |
| Laptop/device support | Device type/model, OS, issue, asset/serial if available, physical condition and intake consent | Triage → drop-off receipt → diagnosis → repair consent if needed → ready for collection → verified handover. Record accessories and custody timestamps; do not collect device passwords in tickets. |
| ID card replacement | College ID, lost/damaged reason, programme/department; photo only if approved policy requires it | Validate identity → administrative approval → production → ready for collection → collection recorded. Fees, if applicable, are handled outside launch scope. |
| Wi-Fi issue | Building, floor/room, SSID, device OS, time/frequency, symptoms, affected users | Route to NOC → diagnose → link related outage if relevant → confirm service restoration. Avoid collecting browsing history or unnecessary device identifiers. |
| CCTV review | Verified staff requester, incident purpose, location, requested time window | Restricted triage → designated approval → authorized reviewer records outcome → requester receives permitted summary. Store footage outside ordinary tickets; no student self-service access or public footage links. |
| General IT support | Subcategory such as classroom equipment, printing, software, or other | Route to responsible team → clarification/diagnosis → resolution. Unsupported requests receive a clear referral. |

Attachment defaults: up to five files, 10 MB each, allowlisted PDF/JPEG/PNG only. Validate extension, MIME and file signature; quarantine and scan before availability. Reject executable, HTML, SVG, and archive uploads at launch. Download with safe filenames and content disposition. Rich descriptions use sanitized text/Markdown, never arbitrary HTML.

### 4.2 Ticket lifecycle

```text
Submitted → Triaged → In progress → Resolved → Closed
                       ↕
             Waiting for requester / Waiting for approval /
                         Waiting for external party
Resolved → In progress (reopened)
Submitted / Triaged → Cancelled (requester, if no work started)
Other active states → Cancelled (agent, with reason)
```

- Agents triage and prioritize; requester impact is input, not authority to set urgency.
- Approval is a separate record with pending/approved/rejected status. Only the assigned approver may decide; rejection requires a reason and does not imply successful resolution.
- Completing sensitive work requires recorded approval. Approvers cannot approve their own cases.
- Resolution requires a public summary, resolution code, and any category completion evidence.
- Default proposal: auto-close seven calendar days after resolution; allow reopening during that interval. After closure, create a linked follow-up ticket. Leads may reopen a closed case with an audited reason.
- Version checks prevent two agents silently overwriting assignments or state. The server records events in the same transaction as the change.

### 4.3 Service targets and escalation

The following are proposed operating targets, subject to staffing approval. Configure working days, Nepal holidays, opening hours, and exceptions before activation. Use `Asia/Kathmandu` for display and business calendars; store timestamps in UTC. These targets do not imply 24/7 staffing.

| Priority | Example | First human response | Resolution target |
|---|---|---|---|
| P1 Critical | Campus-wide teaching/network disruption | 30 business minutes | 4 business hours |
| P2 High | Multiple users or urgent classroom impact | 2 business hours | 1 business day |
| P3 Normal | Individual device/account issue | 1 business day | 3 business days |
| P4 Low | Advice or planned request | 2 business days | 5 business days |

First-response clock starts at submission and stops at the first human public reply, not an automated acknowledgement. Resolution clock pauses only while waiting for the requester; internal approval and external-party waits do not pause it by default. Notify the assignee at 75% of target and the lead at breach, once per threshold. Reopened cases resume accumulated business time. Reports distinguish elapsed time from paused time and explain exclusions. Targets represent escalation goals, not guaranteed repair or card-production times.

## 5. Information architecture and journeys

| Route | Main content |
|---|---|
| `/` | IIC identity, help search, create-request CTA, six services, featured guides, status, contacts |
| `/services` and `/services/[slug]` | Eligibility, required information, expected process, submit action |
| `/help` and `/help/[slug]` | Searchable guides, breadcrumbs, steps, related resources, review date |
| `/software` | Filterable eligible software catalogue |
| `/status` | Current service conditions, maintenance, incident history |
| `/contact` | Verified IIC location, hours, email and accessibility support |
| `/recover-account` | Public restricted recovery intake |
| `/login` | Institutional sign-in and recovery alternative |
| `/dashboard` | Requester summary and pending actions |
| `/tickets/new` and `/tickets/[id]` | Form, receipt, timeline and conversation |
| `/staff/queue` and `/staff/tickets/[id]` | Agent queue and case workspace |
| `/staff/approvals`, `/staff/content`, `/staff/reports` | Role-specific workspaces |

Primary journey: find relevant service → read eligibility → sign in where required → complete short form → review → receive reference → follow timeline → reply → confirm resolution. Recovery bypasses institutional sign-in and keeps case access restricted until identity is verified.

Agent workspace: filters at left/top, paginated queue in the centre, ticket detail with requester context and explicit public/internal composer. Sensitive cases display access classification. Mobile layouts prioritize the conversation and next action; tables have labelled horizontal scrolling or card alternatives.

## 6. IIC visual design system

### 6.1 Brand treatment

Use the supplied IIC/ING logo as visual reference. Blue is the primary identity colour; red is a restrained brand accent; green reflects the ING mark. Values below are **proposed approximations from the supplied raster**, not sampled or certified official brand specifications. Obtain an approved SVG or transparent high-resolution master before release. Do not redraw, recolour, stretch, or crop the logo lockup.

Place the complete lockup on a white or approved neutral panel, including in dark mode. Preserve aspect ratio and reserve clear space of at least one crest-quarter width as an interim design rule. Target desktop logo width 260–320 px; verify legibility on mobile rather than compressing the full lockup excessively. Use a crest-only mobile mark only if IIC supplies an approved variant. Logo alt text: “Itahari International College, ING”.

### 6.2 Colour palettes

| Token | Hex | Purpose |
|---|---|---|
| Brand blue | `#234395` | Primary buttons and identity accents |
| Blue hover | `#1B3476` | Hover/pressed primary action |
| Blue tint | `#EEF2FF` | Selected cards and light information surfaces |
| Brand red | `#ED1C24` | Small decorative brand details; not default body text |
| ING green | `#7AC143` | Partner identity and limited decorative accents |
| Page light | `#F8FAFC` | Light theme background |
| Surface light | `#FFFFFF` | Cards, dialogs, header |
| Text light | `#0F172A` | Primary text on light surfaces |
| Muted text light | `#475569` | Secondary text |
| Border decorative | `#CBD5E1` | Dividers; insufficient alone for required control boundaries |
| Control border light | `#64748B` | Inputs and meaningful outlines |
| Page dark | `#0B1220` | Dark theme background |
| Surface dark | `#111C30` | Dark cards and dialogs |
| Elevated dark | `#1E293B` | Hover surfaces and menus |
| Text dark | `#F8FAFC` | Dark theme primary text |
| Muted text dark | `#CBD5E1` | Dark secondary text |
| Control border dark | `#94A3B8` | Meaningful dark control boundaries |
| Interactive dark | `#A5B4FC` | Dark-theme links/focus; pair with dark text if used as fill |

| Semantic state | Light foreground / background | Dark foreground / background |
|---|---|---|
| Success / operational | `#166534` / `#F0FDF4` | `#86EFAC` / `#052E16` |
| Warning / waiting | `#92400E` / `#FFFBEB` | `#FCD34D` / `#451A03` |
| Error / outage | `#B91C1C` / `#FEF2F2` | `#FCA5A5` / `#450A0A` |
| Information / active | `#1E40AF` / `#EFF6FF` | `#93C5FD` / `#172554` |
| Neutral / closed | `#475569` / `#F1F5F9` | `#CBD5E1` / `#1E293B` |

Use white text on brand blue; use dark text on ING green. Brand red and green are not automatic success/error tokens. Status must include text and an icon, never colour alone. Verify all actual combinations, hover states, and transparency against contrast requirements during implementation.

```css
:root {
  --brand-primary: #234395;
  --brand-primary-hover: #1B3476;
  --brand-accent: #ED1C24;
  --brand-partner: #7AC143;
  --background: #F8FAFC;
  --surface: #FFFFFF;
  --foreground: #0F172A;
  --muted-foreground: #475569;
  --control-border: #64748B;
  --link: #234395;
  --focus: #234395;
}
[data-theme="dark"] {
  --background: #0B1220;
  --surface: #111C30;
  --foreground: #F8FAFC;
  --muted-foreground: #CBD5E1;
  --control-border: #94A3B8;
  --link: #A5B4FC;
  --focus: #A5B4FC;
}
```

### 6.3 Typography, layout, and components

- Typeface proposal: self-hosted Inter with system sans-serif fallback. Add Noto Sans Devanagari if Nepali content is introduced; include applicable font licences.
- Body 16 px/1.6; secondary 14 px/1.5; labels 14 px medium; page headings 32–40 px; hero 36 px mobile to 56 px desktop. Avoid tiny uppercase instructional text.
- Use an 8 px spacing rhythm with 4 px fine adjustments: 4, 8, 12, 16, 24, 32, 48, 64, 96 px.
- Container maximum 1200 px; gutters 16 px mobile, 24 px tablet, 32 px desktop. Service cards: one column below 640 px, two from 640 px, three from 1024 px.
- Form width 640–720 px; inputs minimum 44 px height; main touch targets aim for 44×44 px. Card padding 24 px; radius 16 px; control radius 10 px.
- Subtle light shadow: `0 4px 20px rgba(15,23,42,.06)`. Dark surfaces use elevation and borders instead of heavy shadows.
- Consistent outlined icons at 20/24 px. Decorative icons are hidden from assistive technology; icon-only actions have accessible names.
- Required components: header, footer, service card, search/filter bar, guide card, software row, status badge, notice banner, form field/error, file upload, stepper, ticket timeline, reply composer, queue table, pagination, dialog, toast, skeleton, empty state, and error panel.
- Theme defaults to system preference with a persistent explicit override. Avoid a theme flash during server rendering. Authentication data must never be stored with theme preferences.

### 6.4 Motion specification

Use CSS transitions for simple effects and Motion for React only for coordinated interactions. Animation supports orientation and feedback; it must not delay submission or reading.

| Interaction | Specification |
|---|---|
| Button/card hover | 120–180 ms; colour/shadow transition; optional card translateY of -2 px |
| Accordion/dialog | 180–240 ms; small opacity/position transition; focus managed immediately |
| Page content entrance | 200–300 ms opacity and maximum 8 px vertical offset; no forced replay on every update |
| List appearance | Optional 40 ms stagger, capped at 240 ms total; no stagger in dense agent queues |
| Pending actions | Stable button size and text; announce processing; prevent duplicates |
| Reduced motion | Remove translation, parallax, shimmer and stagger; use instant state changes or minimal fades |

Animate transform and opacity where possible. Do not add autoplay video, infinite decorative loops, fake live diagrams, or scroll-jacking. Loading uses a static placeholder under reduced-motion preferences. Smooth scrolling must respect user settings. All content remains accessible if animation fails.

## 7. Technical architecture

```text
Browser
  → HTTPS reverse proxy on one public origin
      → / and application routes: Next.js
      → /api/v1/* and /auth/*: Django + Django REST Framework
          → PostgreSQL (authoritative records)
          → Private object storage (attachments/resources)
          → Queue/broker → background workers → email and scanning
          → Institutional identity provider
```

Use Next.js App Router with TypeScript. Server-render public content; use client components for forms, filters, conversations and motion. Django owns business rules and permissions. Use PostgreSQL for transactional data and initial full-text search, Redis as a broker/cache, and Celery workers for notifications, deadlines, scans and exports. These are proposed technology choices, not verified installations.

Prefer Django 5.2 LTS with a current security patch and a compatible DRF release; select a supported Next.js stable release at implementation. Pin Python, Node, React, framework and library versions after validating their compatibility together. Do not use floating production dependencies. Official references: [Django support/download policy](https://www.djangoproject.com/download/), [DRF documentation](https://www.django-rest-framework.org/), [Next.js App Router](https://nextjs.org/docs/app/getting-started).

### 7.1 Authentication and caching

Use server-managed Django sessions through the shared origin, with Secure, HttpOnly, SameSite cookies, CSRF protection on unsafe requests, session rotation on login, and server-side logout/revocation. Validate OIDC state, nonce, issuer, audience and signature; use a maintained identity library. Enforce MFA for privileged accounts through the identity provider, plus a controlled emergency administrator procedure.

Do not store bearer credentials in localStorage. Authenticated pages/API responses use private/no-store caching; disable shared Next.js/CDN caching of user data. Public guides may be cached and invalidated on publication. Signed attachment links expire within five minutes and are issued only after authorization. No open CORS wildcard with credentials.

### 7.2 Data model

| Entity | Core data and relations |
|---|---|
| User/Profile | UUID, identity-provider subject, verified email, role grants, programme/department, active state |
| ServiceCategory | Name, slug, eligibility, versioned form schema, routing team, active state |
| Ticket | UUID, unique display reference, requester, category/schema version, status, priority, team, assignee, version, deadlines, timestamps |
| ServiceDetail | Validated category-specific fields; sensitive recovery/CCTV fields isolated with explicit permissions |
| Message | Ticket, author, public/internal visibility, body, created time; edits audited |
| Attachment | Ticket/message, owner, storage key, MIME, size, hash, scan state, classification, retention date |
| TicketEvent | Ticket, actor, action, before/after metadata, timestamp |
| Approval | Ticket, designated approver, decision, reason, decision time |
| DeviceIntake | Ticket, condition, accessories, receipt, custody events and collection verification |
| Article/Revision | Slug, content, tags, audience, publication state, owner, reviewed date |
| SoftwareResource | Product, OS/architecture/version, licence/eligibility, approved URL, guide relation |
| Service/Incident | Service state, incident timeline, source, owner, updated time |
| Announcement | Audience, priority, body, start/end, dismissal identifier |
| Notification/Outbox | Recipient, channel, event key, delivery state, attempt count |
| BusinessCalendar/SLA | Timezone, working periods, holidays, thresholds and pause policy |
| AuditEvent | Actor, resource, action, timestamp, correlation ID, redacted metadata |

Use database constraints for unique references, one decision per approval, and idempotency keys. Index queue fields and ticket/time relations. Store flexible form answers only after schema validation; keep query-critical fields relational. Record deletion/anonymization jobs and prevent deletion of referenced configuration until historical references are preserved.

### 7.3 API surface

All routes are under `/api/v1` unless otherwise noted.

| Method and route | Behaviour |
|---|---|
| `GET /me` | Current user and authorized capabilities |
| `GET /services`, `/articles`, `/software`, `/status` | Visibility-filtered public/authenticated resources |
| `POST /recovery-requests` | Rate-limited public intake; generic acknowledgement |
| `GET, POST /tickets` | Authorized list and validated creation |
| `GET, PATCH /tickets/{id}` | Authorized details and permitted editable fields |
| `POST /tickets/{id}/transitions` | Explicit state transition, reason and expected version |
| `POST /tickets/{id}/assignments` | Team/assignee changes by authorized staff |
| `GET, POST /tickets/{id}/messages` | Visibility-filtered conversation |
| `POST /tickets/{id}/attachments` | Upload into quarantine |
| `GET /attachments/{id}/download` | Authorization plus clean-scan check before download |
| `POST /approvals/{id}/decision` | Authorized decision with conflict protection |
| `GET /notifications`, `POST /notifications/{id}/read` | User-scoped notifications |
| `GET /reports/summary`, `POST /reports/exports` | Scoped metrics and asynchronous export |
| Staff content endpoints | Role-limited draft/edit/publish/archive operations |

Use OpenAPI as the contract and generate typed frontend clients. Lists default to 20 and cap at 100 items; validate sort/filter fields. Return UTC ISO 8601 timestamps. Error shape: `{code, message, field_errors, request_id}`. Use 400 for validation, 401 for missing authentication, 403 for forbidden operations, 404 to conceal inaccessible object existence, 409 for version/state conflicts, 413 for oversize files, and 429 with Retry-After for throttling. Creation supports an idempotency key scoped to user and operation, with payload-hash conflict detection and a proposed 24-hour lifetime.

Workers consume a transactional outbox so a saved ticket is not lost when email is unavailable. Retry with exponential backoff, deduplicate by event/recipient/channel, and alert on dead-letter failures. Poll active ticket views approximately every 30 seconds while visible; real-time sockets are optional later.

## 8. Non-functional requirements

Targets below are proposed acceptance budgets and require testing against the final deployment.

| ID | Area | Measurable requirement |
|---|---|---|
| NFR-01 | Accessibility | Target WCAG 2.2 AA. Keyboard-complete workflows, labelled controls, error associations, visible unobscured focus, dialog focus return, status announcements, and reduced-motion support. Normal text contrast ≥4.5:1; large text and meaningful UI graphics ≥3:1. |
| NFR-02 | Responsive design | Operate from 320 px to 1920 px; no page-level horizontal overflow. Validate at 200% text zoom and narrow/reflow layouts. |
| NFR-03 | Frontend performance | Mobile p75 LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1. Before field data exists, use agreed mobile lab profiles and record results; lab tests alone do not establish field compliance. |
| NFR-04 | API performance | At the agreed test load: p95 reads ≤500 ms, ordinary writes ≤800 ms, errors <1%, excluding external provider latency and file transfer. |
| NFR-05 | Capacity | Initial test assumption: 5,000 accounts, 100,000 historical tickets and 100 concurrent active users. Run a 30-minute mixed workload averaging 20 requests/sec, including writes; revise with IIC usage forecasts. |
| NFR-06 | Availability | Target 99.5% monthly application availability, measured by external probes; document maintenance separately. Report provider outages separately without hiding user-facing downtime. |
| NFR-07 | Recovery | Target RPO ≤1 hour using database log archival; RTO ≤4 hours. Daily snapshots, object versioning, encrypted offsite copies, and quarterly restore exercises. |
| NFR-08 | Security | HTTPS throughout, secrets manager, least privilege, object-level authorization, upload scanning, CSRF/XSS defenses, redacted logging, and no unresolved critical/high exploitable findings at launch. |
| NFR-09 | Privacy | Collect only necessary data; restrict recovery/CCTV cases; show purpose and retention notices. Ticket contents and identifiers must not enter third-party analytics. |
| NFR-10 | Reliability | Atomic ticket writes, safe job retries, no duplicate receipts for a single event, graceful email/identity/storage outage states, and explicit unsaved-change handling. |
| NFR-11 | Maintainability | Modular Django apps, TypeScript checks, consistent formatting, documented APIs, migration reviews, automated critical-path tests, and dependency update ownership. |
| NFR-12 | Observability | Structured redacted logs, request IDs, uptime/error/latency dashboards, worker lag, scan failures, backup age, and alert routing to a named operator. |
| NFR-13 | Compatibility | Test current and previous stable Chrome, Edge, Firefox and Safari, plus Android Chrome and iOS Safari available at release. |
| NFR-14 | Localization | English launch; Unicode content, translatable UI strings, Kathmandu timezone, unambiguous dates and timezone labels. Nepali UI is a separately scoped enhancement. |
| NFR-15 | Search/indexing | Public guides have titles, descriptions, canonical URLs and sitemap. Private routes use noindex plus authentication; robots directives never substitute for access control. |

Accessibility reference: [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/). The document proposes a conformance target; it is not a certification.

### 8.1 Privacy, abuse prevention, and retention

- Public recovery intake uses generic responses to prevent account enumeration. Initial limits: five submissions per IP per hour with additional identifier-based protection and monitored exceptions for shared campus networks.
- Staff identity verification uses approved existing records/in-person processes, not emailed passwords or unnecessary identity-document uploads. Alternative contact verification alone does not prove institutional identity.
- Proposed retention defaults: ordinary tickets 24 months after closure; ordinary attachments 12 months; abandoned recovery intake 30 days; sensitive recovery/CCTV evidence 90 days after closure; audit events 24 months; rolling backups 30 days. IIC must validate these before production; they are not statements of legal requirements.
- Support authorized holds, scheduled deletion/anonymization, and deletion reapplication after backup restoration. Document how retained backups expire.
- Restrict sensitive storage and audit access. Do not put CCTV footage in general attachments. If storage of footage is later required, define a separate access, approval and retention design.
- Do not promise Nepal-specific legal compliance without institutional/legal review of actual processing, hosting location and third-party contracts.

## 9. Deployment, administration, and operations

Use separate development, staging, and production environments with independent databases, buckets, credentials, and identity clients. Staging uses synthetic data. Deploy containerized Next.js, Django, worker, scheduler and reverse-proxy services; use managed PostgreSQL/object storage if operationally appropriate. Hosting provider, domain, region and budget remain undecided.

CI gates: formatting, TypeScript/build checks, backend checks, critical workflow tests, dependency/security scanning and migration validation. Releases use backward-compatible migrations and a documented application rollback. Destructive data changes require an explicit migration plan and recoverable backup; restoring a database is not a routine code rollback.

Operational documentation must cover deployment, rollback, restore, identity-provider outage, failed notifications, attachment quarantine, SLA calendars, staff onboarding/offboarding, credential rotation, and content review. Health checks distinguish process liveness from readiness. Alert on failed backups, prolonged queue lag, elevated errors and storage exhaustion.

Content editors review guides at least every six months or after relevant software changes. Store a review date and owner; flag overdue resources. Software link checking must protect against SSRF: allow approved hosts, block private addresses, limit redirects/timeouts, and do not fetch arbitrary submitted URLs.

## 10. Validation and acceptance plan

| Test | Requirements | Pass condition |
|---|---|---|
| Student complete journey | FR-02, 04, 05, 07, 08 | Sign in, submit, receive reference, reply, view resolution and reopen within policy |
| Cross-user isolation | FR-05, 07, 09; NFR-08 | Another user's guessed ID, search result, export or file link exposes no content |
| Locked-out user | FR-03 | Intake works without college login, remains generic, and staff action requires recorded verification |
| Staff-only approval | FR-09 | Student requests rejected server-side; self-approval blocked; decision recorded |
| Duplicate/concurrent writes | FR-04, 08; NFR-10 | Retry creates one ticket; stale agent mutation receives conflict without overwriting data |
| File safety | FR-07; NFR-08 | Oversize/disallowed/infected files rejected or quarantined; unscanned files never downloadable |
| Notification outage | FR-14; NFR-10 | Ticket saves during provider failure; delivery retries without duplicated successful notifications |
| SLA calendar | FR-08, 16 | Holidays, outside-hours submission, pauses and reopening produce correct deadlines and reports |
| Content and status | FR-10–13 | Drafts remain private; scheduling, audience restrictions and stale-status behaviour work |
| Accessibility | NFR-01, 02 | Automated checks plus keyboard/screen-reader review of all core journeys; contrast and reduced-motion verified |
| Performance/load | NFR-03–05 | Budgets met under recorded device/network/load profiles |
| Recovery drill | NFR-07 | Restore into isolated environment within RTO with data loss within RPO |

Use backend integration tests for permissions and transitions, frontend component tests for nontrivial form behaviour, and end-to-end tests for these journeys. Complete user acceptance with a student, staff requester, IT agent, approver and content editor. Record defects, evidence and sign-off; no launch with unresolved access-control failures.

## 11. Delivery sequence and definition of done

| Stage | Deliverables | Exit condition |
|---|---|---|
| 1. Discovery | Confirm policies, roles, six services, identity provider, content inventory and brand assets | Named owners accept decisions and scope |
| 2. UX/design | Mobile/desktop screens, both themes, components and key form prototypes | Core journeys reviewed for clarity/accessibility |
| 3. Foundation | Environments, auth, permissions, schema, OpenAPI and design tokens | Login and cross-user isolation verified |
| 4. Helpdesk | Intake, queues, conversation, approval, uploads, SLA and notifications | Core end-to-end tests pass |
| 5. Content/operations | Guides, software, announcements, status, reports, audit and retention jobs | Content owners validate material; operating runbooks ready |
| 6. Pilot/release | Load/security/accessibility tests, restore drill, training and monitored pilot | UAT accepted and launch checklist complete |

Do not commit a delivery date before staffing and integration details are known. Each stage is a dependency milestone, not a fixed time estimate.

Definition of done: code and migrations reviewed; acceptance tests passed; responsive/theme states complete; accessible content approved; production configuration and monitoring verified; restoration demonstrated; staff trained; ownership assigned; unresolved low-risk issues documented with owners and dates.

## 12. Decisions IIC must finalize before production

These decisions do not block use of this specification as a planning baseline.

1. Official domain, support email, helpdesk location, opening hours, holidays and escalation contacts.
2. Institutional identity provider, allowed account domains and authoritative student/staff role source.
3. Approved logo master, exact brand values and permissible mobile logo treatment.
4. CCTV request eligibility, approver, evidence handling and review procedure; staff-only is the proposed launch default.
5. Account recovery identity checks, device intake consent and ID replacement/collection rules.
6. Service targets, staffing capacity, priority overrides and retention schedule.
7. Authorized software catalogue, institutional licences and ownership of installation instructions.
8. Hosting region, budget, backup destination, email provider and incident response owner.

## 13. Sources and provenance

- [Islington IT & NOC Helpdesk](https://itdesk.islingtoncollege.edu.np/) — public homepage text and browser inspection, 10 September 2026.
- [Herald IT Support](https://itsupport.heraldcollege.edu.np/) — public browser inspection including initial advice overlay and homepage, 10 September 2026.
- User-supplied IIC/ING raster logo — identity reference; no official brand manual supplied.
- [Django](https://www.djangoproject.com/download/), [Django REST Framework](https://www.django-rest-framework.org/), [Next.js](https://nextjs.org/docs/app/getting-started) — official framework references reviewed during preparation; versions must be confirmed at implementation.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — normative accessibility reference for the proposed target.

All IIC workflows, architecture, role rules, palettes, performance budgets, retention periods and delivery stages are recommendations developed for this project, not claims about the internals of the reference websites.
