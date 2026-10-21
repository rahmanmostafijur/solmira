# syntax=docker/dockerfile:1.7
# One Dockerfile for every NestJS service:
#   docker build -f infra/docker/service.Dockerfile --build-arg SERVICE=identity-service .
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
WORKDIR /repo

# Stage 1: reduce the monorepo to the one service and the workspace packages it depends on,
# so unrelated changes do not invalidate this image's layer cache.
FROM base AS pruner
ARG SERVICE
RUN npm install -g turbo@2.11.5
COPY . .
RUN turbo prune "@solmira/${SERVICE}" --docker

# Stage 2: install from the pruned lockfile (cached layer), then build.
FROM base AS builder
ARG SERVICE
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ ./
COPY tsconfig.base.json ./
RUN pnpm turbo run build --filter="@solmira/${SERVICE}"
# Production-only node_modules with workspace packages copied in (not symlinked).
RUN pnpm --filter="@solmira/${SERVICE}" deploy --prod --legacy /out

# Stage 3: minimal runtime. No compiler, no dev dependencies, no source, non-root user.
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache tini
WORKDIR /app
# The deploy output contains only what each package's "files" whitelist allows (dist, and for
# identity-service its SQL migrations) plus production node_modules.
COPY --from=builder --chown=node:node /out ./
# The RDS certificate authorities. Node trusts them in addition to its own (NODE_EXTRA_CA_CERTS in the
# task definition), so a connection string with sslmode=verify-full checks the database's identity.
# The checksum pins the file: when AWS publishes a new bundle the build fails until it is updated
# deliberately (docs/operations/certificate-bundle.md).
ADD --chown=node:node --checksum=sha256:90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b   https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/certs/rds-global-bundle.pem
USER node
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health/live" || exit 1
# tini forwards SIGTERM so Nest shutdown hooks run and connections drain on redeploys.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
