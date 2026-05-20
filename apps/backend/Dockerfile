# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/backend/package.json apps/backend/
COPY packages/types/package.json packages/types/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @wpt/backend --filter @wpt/types

FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY tsconfig.base.json ./
COPY packages/types/ packages/types/
COPY apps/backend/ apps/backend/
RUN pnpm --filter @wpt/types run build
RUN pnpm --filter @wpt/backend run build

# prod-deps: install production-only dependencies (excludes drizzle-kit and other devDeps)
FROM base AS prod-deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/backend/package.json apps/backend/
COPY packages/types/package.json packages/types/
ENV NODE_ENV=production
# --shamefully-hoist places shared deps in /app/node_modules so the runner
# stage can COPY them. Without this, pnpm's isolated linker leaves /app/node_modules
# empty when used with --filter, breaking the runner stage.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --shamefully-hoist --filter @wpt/backend --filter @wpt/types

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
LABEL org.opencontainers.image.source=https://github.com/dvdmarchetto/Wpt
LABEL org.opencontainers.image.description="WPT IoT Backend — Fastify 5 + Drizzle + UDP pipeline"
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=builder /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/drizzle ./apps/backend/drizzle
COPY --from=builder /app/packages/types ./packages/types

EXPOSE 3000
CMD ["node", "apps/backend/dist/index.js"]
