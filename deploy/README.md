# Deployment — File Upload Stack

This folder contains server-side config files that are **not** deployed
automatically by Jenkins. Copy them to the server manually once and they
persist across deploys.

---

## Request flow

```
Browser → Cloudflare edge → cloudflared → Next.js :3000 → Django :8000
```

For file upload chunks the full chain must allow large bodies and long
timeouts at every hop.

---

## 1 — Cloudflare dashboard

Log in to dash.cloudflare.com → your zone → **Network** tab.

| Setting | Value |
|---------|-------|
| Maximum Upload Size | **100 MB** (Free/Pro default — sufficient for 2 MB chunks) |

No dashboard change is needed unless you raise `chunk_size_mb` above 100 MB
in **Admin → Settings → File uploads** (not recommended on Free/Pro).

---

## 2 — cloudflared config

```bash
sudo cp /path/to/repo/cloudflared-config.yml /etc/cloudflared/config.yml
# Edit the file: replace <YOUR_TUNNEL_ID> with your actual tunnel UUID
sudo nano /etc/cloudflared/config.yml
sudo systemctl restart cloudflared
```

The critical setting is `noChunkedEncoding: false` — this tells cloudflared
to **stream** the request body to the origin instead of buffering it, which
eliminates the 502 that occurs when a 2 MB chunk takes longer than
cloudflared's internal buffer flush timeout.

---

## 3 — Gunicorn config

```bash
sudo cp /path/to/repo/backend/gunicorn.conf.py /var/www/iic-app/backend/gunicorn.conf.py
```

Update the systemd unit to use it:

```bash
sudo nano /etc/systemd/system/iic-helpdesk-backend.service
```

Change the `ExecStart` line to:

```ini
ExecStart=/var/www/iic-app/backend/venv/bin/gunicorn \
    Project.wsgi \
    --config /var/www/iic-app/backend/gunicorn.conf.py
```

Then reload:

```bash
sudo systemctl daemon-reload
sudo systemctl restart iic-helpdesk-backend
```

Key values in `gunicorn.conf.py`:

| Setting | Value | Why |
|---------|-------|-----|
| `worker_class` | `gthread` | SSE streams + uploads don't block each other |
| `workers` | `cpu_count` | One process per core |
| `threads` | `4` | Concurrent requests per worker |
| `timeout` | `120` | Enough for 50 MB chunk at 5 Mbps (~80 s) |

---

## 4 — Next.js proxy timeout

Already set in `frontend/next.config.ts`:

```ts
experimental: { proxyTimeout: 120_000 }
```

This is deployed automatically by Jenkins via the normal frontend build.

---

## 5 — Diagnosing "stuck on chunk 1"

If uploads appear to hang after chunk 0 completes, the causes (in order of likelihood):

### 5a — `DATA_UPLOAD_MAX_MEMORY_SIZE` was too large (FIXED in settings.py)

Previously set to 26 GB, which made Django's multipart parser slow before reading
any bytes. Now set to 60 MB (covers one 50 MB chunk + overhead).

### 5b — Gunicorn sync workers exhausted

Sync workers handle one request at a time. If all workers are busy (SSE streams,
other requests), chunk 1's connection queues and the XHR appears to hang.

**Fix**: deploy `gunicorn.conf.py` (see step 3) which switches to `gthread` workers.

### 5c — CSRF token rotation

Django may issue a new CSRF token after each request. The frontend now re-fetches
the token for every chunk (`csrfToken()` called per attempt), so this is handled.

### 5d — XHR timeout

Each chunk XHR now has a 60-second timeout (`xhr.timeout = 60_000`). If Django
doesn't respond within 60 s, the chunk is retried with exponential back-off.

---

## Timeout ladder summary

| Hop | Timeout | Config |
|-----|---------|--------|
| Cloudflare edge → cloudflared | 100 s (CF internal) | — |
| cloudflared → Next.js | streams (no buffer) | `noChunkedEncoding: false` |
| Next.js → Django | 120 s | `proxyTimeout: 120_000` |
| Django / Gunicorn worker | 120 s | `timeout = 120` |

With 2 MB chunks at 5 Mbps ≈ 3 s per chunk — well within every timeout in
the ladder. Even at 512 Kbps (slow mobile) a 2 MB chunk takes ~32 s —
still under all 120 s limits.
