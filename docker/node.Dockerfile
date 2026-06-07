# docker/node.Dockerfile — shared base for all 9 Node agents.
#
# Single template, parameterized by `SERVICE` build-arg (auth, billing, oauth,
# ingest, dashboard, studio, monitoring, distributor, analyst).
#
# Build via docker-bake.hcl: `docker buildx bake node-runtime`
# Or directly: `docker build --build-arg SERVICE=auth -t vireo/auth .`
#
# Result: ~180 MB image per service, ~30s rebuild on source-only changes
# (workspace deps cached in a separate layer).

ARG NODE_VERSION=20

# ---- Stage 1: workspace deps -----------------------------------------
# Installs the FULL workspace (root + every agent + packages/storage)
# so a single cache layer covers dep changes for all 9 Node services.
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /workspace
RUN apk add --no-cache python3 make g++ \
    && ln -sf python3 /usr/local/bin/python

# Copy ONLY the manifests first to maximise layer cache hits.
COPY package.json package-lock.json* ./
COPY agents/auth/package.json         agents/auth/
COPY agents/billing/package.json      agents/billing/
COPY agents/oauth/package.json        agents/oauth/
COPY agents/ingest/package.json       agents/ingest/
COPY agents/studio/package.json       agents/studio/
COPY agents/monitoring/package.json   agents/monitoring/
COPY agents/distributor/package.json  agents/distributor/
COPY agents/analyst/package.json      agents/analyst/
COPY apps/dashboard/package.json      apps/dashboard/
COPY packages/storage/package.json    packages/storage/
COPY packages/shared/package.json     packages/shared/

# Install with dev deps so tests can run in CI.
# `npm install` (not `npm ci`) is more forgiving in the absence of a lockfile.
RUN npm install --workspaces --include-workspace-root --no-audit --no-fund \
    || npm install --workspaces --include-workspace-root --no-audit --no-fund

# ---- Stage 2: runtime -------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /workspace

# Tini for proper signal handling (graceful shutdown of Node servers).
RUN apk add --no-cache tini curl \
    && addgroup -S vireo && adduser -S vireo -G vireo

# Copy installed deps from the deps stage.
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/agents/auth/node_modules        agents/auth/node_modules
COPY --from=deps /workspace/agents/billing/node_modules     agents/billing/node_modules
COPY --from=deps /workspace/agents/oauth/node_modules       agents/oauth/node_modules
COPY --from=deps /workspace/agents/ingest/node_modules      agents/ingest/node_modules
COPY --from=deps /workspace/agents/studio/node_modules      agents/studio/node_modules
COPY --from=deps /workspace/agents/monitoring/node_modules  agents/monitoring/node_modules
COPY --from=deps /workspace/agents/distributor/node_modules agents/distributor/node_modules
COPY --from=deps /workspace/agents/analyst/node_modules     agents/analyst/node_modules
COPY --from=deps /workspace/apps/dashboard/node_modules     apps/dashboard/node_modules
COPY --from=deps /workspace/packages/storage/node_modules   packages/storage/node_modules
COPY --from=deps /workspace/packages/shared/node_modules    packages/shared/node_modules

# Copy source for the whole repo (kept small via .dockerignore).
COPY package.json ./
COPY agents/  agents/
COPY apps/    apps/
COPY packages/ packages/
COPY tests/   tests/

# Build arg selects which agent this image runs.
ARG SERVICE
ENV SERVICE=${SERVICE}
ENV NODE_ENV=production
ENV PORT=8000

USER vireo
EXPOSE 8000

# Healthcheck — every agent exposes /health on the same port.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-lc", "node agents/${SERVICE}/src/server.js"]
