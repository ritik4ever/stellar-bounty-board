# ==============================================================================
# Stellar Bounty Board - Backend Service Dockerfile
# ==============================================================================
# Multi-stage Docker build separating compile/build tools from runtime.
# This prevents leaking devDependencies, TypeScript toolchains, and source
# files into the production image, minimizing the final attack surface.

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
