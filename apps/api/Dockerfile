# Build context is the repo root: docker build -f apps/api/Dockerfile .
FROM node:24-alpine AS pruner
RUN npm install -g turbo@2.11.9
WORKDIR /app
COPY . .
RUN turbo prune api --docker

FROM node:24-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile --prod

# Bun runs the TypeScript sources directly, there is no build step.
FROM oven/bun:1.4.2-alpine AS base
WORKDIR /app
ENV NODE_ENV=production PORT=3001
COPY --from=deps --chown=bun:bun /app ./
COPY --from=pruner --chown=bun:bun /app/out/full/ ./
USER bun


FROM base AS runner
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3001/health >/dev/null || exit 1
CMD ["bun", "apps/api/src/index.ts"]
