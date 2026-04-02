# Stage 1: Install dependencies
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/types/package.json packages/types/
COPY apps/simulator/package.json apps/simulator/
RUN pnpm install --frozen-lockfile --filter @wpt/simulator --filter @wpt/types

# Stage 2: Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY packages/types/ packages/types/
COPY apps/simulator/ apps/simulator/
RUN pnpm --filter @wpt/types run build
RUN pnpm --filter @wpt/simulator run build

# Stage 3: Production
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/apps/simulator/dist ./dist
COPY --from=builder /app/apps/simulator/public ./public
COPY --from=builder /app/apps/simulator/package.json ./
COPY --from=builder /app/apps/simulator/node_modules ./node_modules
COPY --from=builder /app/packages/types/dist ./node_modules/@wpt/types/dist
COPY --from=builder /app/packages/types/package.json ./node_modules/@wpt/types/

# Create data directory for JSON state persistence (D-14)
RUN mkdir -p /app/data

EXPOSE 3002
EXPOSE 9090/udp
EXPOSE 9091/udp
EXPOSE 9092/udp
EXPOSE 9093/udp

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget --spider -q http://localhost:3002/health || exit 1

CMD ["node", "dist/index.js"]
