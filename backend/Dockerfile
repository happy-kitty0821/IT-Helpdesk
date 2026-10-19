# =============================================================================
# backend/Dockerfile — IIC IT Helpdesk Django backend
# =============================================================================
# Used for: backend (Gunicorn), celery-worker, celery-beat
# Build context: ./backend
# =============================================================================

# ── Stage 1: dependency builder ───────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /app

# System packages needed for Python C extensions (psycopg2, mysqlclient, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies into an isolated prefix so the final stage
# doesn't need build tools.
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

# Runtime-only system libraries (libpq for psycopg2 binary, no gcc needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root application user
RUN groupadd --gid 1001 appgroup && \
    useradd  --uid 1001 --gid appgroup --no-create-home --shell /bin/false appuser

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application source
COPY --chown=appuser:appgroup . .

# Persistent volumes
# /app/media      — uploaded files (ticket attachments, software files)
# /app/staticfiles — collected static assets
# /app/logs       — application logs
VOLUME ["/app/media", "/app/staticfiles", "/app/logs"]

# Django listens on this port (Gunicorn)
EXPOSE 8000

# Switch to non-root user
USER appuser

# Default command: Gunicorn with gthread workers for SSE + upload support.
# Override in docker-compose for celery-worker and celery-beat services.
CMD ["gunicorn", \
     "Project.wsgi:application", \
     "--config", "gunicorn.conf.py"]
