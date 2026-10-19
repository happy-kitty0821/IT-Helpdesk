# =============================================================================
# frontend/Dockerfile — IIC IT Helpdesk Next.js frontend
# =============================================================================
# Build context: ./frontend
# =============================================================================

# ── Stage 1: dependency installer ────────────────────────────────────────────
FROM node:20-slim AS deps

# Install pnpm globally (same tool used in development)
RUN npm install -g pnpm@latest --quiet

WORKDIR /app

# Copy lockfile and manifest first (Docker layer caching)
COPY package.json pnpm-lock.yaml ./

# Install production + dev deps (needed for the build step)
RUN pnpm install --frozen-lockfile

# ── Stage 2: Next.js builder ─────────────────────────────────────────────────
FROM node:20-slim AS builder

RUN npm install -g pnpm@latest --quiet

WORKDIR /app

# Reuse installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source
COPY . .

# DJANGO_INTERNAL_URL is needed at build time by next.config.ts to resolve
# the proxy destination. It is set via --build-arg in docker-compose.
# At runtime, the container reads it from the environment directly.
ARG DJANGO_INTERNAL_URL=http://backend:8000
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=""
ARG NEXT_PUBLIC_DJANGO_URL=""
ARG NEXT_PUBLIC_SITE_URL=""

ENV DJANGO_INTERNAL_URL=$DJANGO_INTERNAL_URL
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_PUBLIC_DJANGO_URL=$NEXT_PUBLIC_DJANGO_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

# Next.js standalone output — produces a self-contained server bundle
# with a minimal node_modules footprint for the final image.
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ── Stage 3: minimal runtime image ───────────────────────────────────────────
FROM node:20-slim AS runtime

# Non-root user
RUN groupadd --gid 1001 appgroup && \
    useradd  --uid 1001 --gid appgroup --no-create-home --shell /bin/false appuser

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Copy the standalone Next.js output (includes its own server.js + mini node_modules)
COPY --from=builder --chown=appuser:appgroup /app/.next/standalone ./
COPY --from=builder --chown=appuser:appgroup /app/.next/static ./.next/static
COPY --from=builder --chown=appuser:appgroup /app/public ./public

EXPOSE 3000

USER appuser

# next.config.ts must set `output: "standalone"` for this to work.
# The standalone server reads DJANGO_INTERNAL_URL at runtime for rewrites.
CMD ["node", "server.js"]
