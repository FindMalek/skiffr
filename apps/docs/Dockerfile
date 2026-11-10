# Build context is the repo root: docker build -f apps/docs/Dockerfile .
FROM node:24-alpine AS base
RUN corepack enable && npm install -g turbo@2.11.9

FROM base AS pruner
WORKDIR /app
COPY . .
RUN turbo prune docs --docker

FROM base AS builder
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
ARG TURBO_API
ARG TURBO_TEAM
ENV NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=secret,id=turbo_token,env=TURBO_TOKEN pnpm turbo build --filter=docs

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3003
COPY --from=builder --chown=node:node /app/apps/docs/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/docs/.next/static ./apps/docs/.next/static

USER node
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3003/docs >/dev/null || exit 1
CMD ["node", "apps/docs/server.js"]
