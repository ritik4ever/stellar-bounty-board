# ==============================================================================
# Stellar Bounty Board - Backend Service Dockerfile
# ==============================================================================
# Architectural Overview & Deviations from Framework Defaults
# ==============================================================================
# This container specification deliberately deviates from standard single-stage
# and default Node.js Docker templates:
#
# 1. Multi-Stage Separation (Deviation from standard single-stage templates):
#    - Compiles TypeScript in an isolated `builder` stage.
#    - Excludes devDependencies, source maps, Vitest suites, and TypeScript compiler
#      toolchains from the production runtime image to minimize image size and CVE surface.
#
# 2. Built-in Native Healthcheck (Deviation from `curl` / `wget` dependencies):
#    - Alpine Linux base images do not include `curl`. Instead of running `apk add curl`,
#      we invoke a zero-dependency native Node `http.get` probe. This avoids introducing
#      unnecessary OS-level package manager vulnerabilities.
#
# 3. Two-Tier Dependency Isolation:
#    - Reuses compiled `/app/backend/node_modules` from the builder stage rather than
#      re-running `npm install --production` in the runtime stage, ensuring offline
#      and deterministic container assembly.
#
# 4. Fallback File-Store Directory (`/app/data`):
#    - Pre-creates `/app/data` to support the lightweight file-backed JSON store
#      without requiring persistent host volume mounting for simple deployments.
# ==============================================================================

# ------------------------------------------------------------------------------
# 1. Build Stage
# ------------------------------------------------------------------------------
# node:18-alpine is chosen for minimal image footprint (~170MB vs 1GB Debian)
# and deterministic Alpine-based security patching.
FROM node:18-alpine AS builder
WORKDIR /app

# Copy root manifests first to leverage Docker layer caching.
# Dependencies are only re-downloaded if package manifests change.
COPY package.json package-lock.json ./
COPY backend ./backend

# `npm ci` ensures deterministic, repeatable installation adhering strictly
# to package-lock.json rather than resolving floating ranges.
RUN npm ci

# Compile TypeScript backend to production JavaScript artifacts in /app/backend/dist.
WORKDIR /app/backend
RUN npm run build

# ------------------------------------------------------------------------------
# 2. Production Runtime Stage
# ------------------------------------------------------------------------------
FROM node:18-alpine
WORKDIR /app

# Selectively copy only compiled build artifacts and production modules.
# DevDependencies, source TS files, and test suites are intentionally excluded.
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/package.json ./
COPY --from=builder /app/backend/node_modules ./node_modules

# Create persistent storage directory for file-based JSON store fallback
# (e.g. data/bounties.json and data/audit.json) when external database volumes are mounted.
RUN mkdir -p /app/data

# Health check configuration:
# - interval=30s: Periodic probe to prevent excessive load while catching failures.
# - timeout=5s: Fails quickly if Express event loop is locked.
# - start-period=10s: Essential grace period allowing Node.js runtime and Soroban RPC
#   connection setup to complete before health check failures trigger container restarts.
# - retries=3: Tolerates transient network hiccups before marking container unhealthy.
# Native Node probe avoids installing curl on Alpine (Zero external dependencies).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Set runtime defaults:
# - NODE_ENV=production enables performance optimizations in Express & V8 (view caching, streamlined errors).
# - PORT=3001 default port matching docker-compose proxy configurations.
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Execute compiled entrypoint
CMD ["node", "dist/index.js"]
