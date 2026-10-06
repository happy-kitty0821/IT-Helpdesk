# ─────────────────────────────────────────────────────────────────────────────
# Gunicorn configuration — IIC IT Helpdesk backend
#
# DEPLOYMENT
# ──────────
# This file is auto-loaded by Gunicorn when you run:
#   gunicorn Project.wsgi --config gunicorn.conf.py
#
# Update the systemd service unit to reference this file, e.g.:
#
#   [Service]
#   ExecStart=/var/www/iic-app/backend/venv/bin/gunicorn \
#       Project.wsgi \
#       --config /var/www/iic-app/backend/gunicorn.conf.py
#
# WHY THESE SETTINGS
# ──────────────────
# • worker_class = gthread
#     Threaded workers handle long-lived SSE streams (dashboard, ticket updates)
#     and large file uploads concurrently without blocking other requests.
#     Sync workers would block for the entire duration of a file write.
#
# • timeout = 120
#     A 50 MB chunk at 5 Mbps takes ~80 s to receive.  The worker timeout must
#     be longer than the worst-case chunk transfer time so Gunicorn doesn't
#     kill the worker mid-upload.  Set to 2 × the expected worst case.
#
# • graceful_timeout = 30
#     On SIGTERM (deploy/restart), give in-flight requests 30 s to finish
#     before the worker is force-killed.
# ─────────────────────────────────────────────────────────────────────────────

import multiprocessing

# ── Binding ───────────────────────────────────────────────────────────────────

bind = "127.0.0.1:8000"

# ── Worker model ──────────────────────────────────────────────────────────────

# gthread: each worker uses a thread pool, so SSE streams and file uploads
# don't monopolise an entire worker process.
worker_class = "gthread"

# One worker process per CPU core, minimum 2.
workers = max(2, multiprocessing.cpu_count())

# Threads per worker — handles concurrent SSE + upload requests.
threads = 4

# ── Timeouts ─────────────────────────────────────────────────────────────────

# Worker timeout: kill and restart a worker if it doesn't respond within
# this many seconds.  Must be > the longest expected request (large chunk
# upload at slow connection speed).
timeout = 120

# On SIGTERM, wait this long for in-flight requests before force-killing.
graceful_timeout = 30

# ── Keep-alive ────────────────────────────────────────────────────────────────

# How long to wait for the next request on a keep-alive connection.
keepalive = 5

# ── Logging ───────────────────────────────────────────────────────────────────

# Log to stdout/stderr so systemd journal captures everything.
accesslog = "-"
errorlog  = "-"
loglevel  = "info"

# Include the response time in access logs — useful for spotting slow uploads.
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s %(L)ss'

# ── Process naming ────────────────────────────────────────────────────────────

proc_name = "iic-helpdesk-backend"
