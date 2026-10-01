# PLC simulator: dev/test stand-in for the ABB AC500, run with the compose
# "simulator" profile. Never published to GHCR nor shipped to customer boxes.
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/simulator/package.json apps/simulator/
COPY packages/types/package.json packages/types/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @wpt/simulator --filter @wpt/types

FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY tsconfig.base.json ./
COPY packages/types/ packages/types/
COPY apps/simulator/ apps/simulator/
RUN pnpm --filter @wpt/types run build
RUN pnpm --filter @wpt/simulator run build

FROM base AS prod-deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/simulator/package.json apps/simulator/
COPY packages/types/package.json packages/types/
ENV NODE_ENV=production
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --shamefully-hoist --filter @wpt/simulator --filter @wpt/types

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/simulator/node_modules ./apps/simulator/node_modules
COPY --from=builder /app/apps/simulator/package.json ./apps/simulator/package.json
COPY --from=builder /app/apps/simulator/dist ./apps/simulator/dist
COPY --from=builder /app/apps/simulator/public ./apps/simulator/public
COPY --from=builder /app/packages/types ./packages/types
RUN mkdir -p /app/data
EXPOSE 3002 9090/udp 9092/udp 9093/udp
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget --spider -q http://127.0.0.1:3002/health || exit 1
CMD ["node", "apps/simulator/dist/index.js"]
