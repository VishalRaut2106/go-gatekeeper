# Multi-stage production build for Gatekeeper Automation & Monitoring Server

# ------------------------------------------------------------------------------
# Stage 1: Builder
# ------------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package manifests
COPY package*.json tsconfig.json ./

# Install all dependencies including devDependencies for build
RUN npm ci

# Copy full application source code
COPY src/ ./src/

# Compile TypeScript to JavaScript in /app/dist
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Production Runtime (Least Privilege)
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner

# Label metadata
LABEL maintainer="Vishal Raut <vishalraut2106@gmail.com>"
LABEL description="Gatekeeper npm Package Automation & Growth Monitoring Server"
LABEL repository="https://github.com/VishalRaut2106/go-gatekeeper"

WORKDIR /app

# Install bash/curl for health checks
RUN apk add --no-cache bash curl

# Copy production package manifests
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled JavaScript output and static frontend assets
COPY --from=builder /app/dist ./dist
COPY src/dashboard/public ./dist/dashboard/public

# Setup persistent data folder and sandboxed temp dir with least privilege
RUN mkdir -p /app/data /tmp/gatekeeper-workers \
    && chown -R node:node /app /tmp/gatekeeper-workers

# Set security environment and run as unprivileged node user
ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0
ENV TEST_TEMP_BASE_DIR=/tmp/gatekeeper-workers
ENV SQLITE_DB_PATH=/app/data/gatekeeper_monitor.db

USER node

# Expose HTTP service port
EXPOSE 4000

# Container Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:4000/api/health || exit 1

# Start the automation server
CMD ["node", "dist/index.js"]
