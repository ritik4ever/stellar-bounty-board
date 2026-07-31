# Build stage
FROM node:18-alpine AS builder
WORKDIR /app

# Copy root and backend dependencies
COPY package.json package-lock.json ./
COPY backend ./backend

# Install dependencies
RUN npm ci

# Build backend
WORKDIR /app/backend
RUN npm run build

# Runtime stage
FROM node:18-alpine
WORKDIR /app

# Copy only production dependencies and built files
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/package.json ./
COPY --from=builder /app/backend/node_modules ./node_modules

# Create data directory for file-based storage
RUN mkdir -p /app/data

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Set environment defaults
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "dist/index.js"]
