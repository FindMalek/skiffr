# Build context is the repo root: docker build -f apps/playground/Dockerfile .
FROM node:24-alpine AS base
RUN corepack enable && npm install -g turbo@2.11.9

FROM base AS pruner
WORKDIR /app
COPY . .
RUN turbo prune playground --docker

FROM base AS deps
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile --prod

# Node 24 runs the TypeScript sources directly, there is no build step. The board pages it replays live in the e2e app.
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3004 HOST=0.0.0.0
COPY --from=deps --chown=node:node /app ./
COPY --from=pruner --chown=node:node /app/out/full/ ./
COPY --from=pruner --chown=node:node /app/apps/e2e/pages ./apps/e2e/pages
USER node
EXPOSE 3004
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3004/health >/dev/null || exit 1
CMD ["node", "apps/playground/src/index.ts"]
