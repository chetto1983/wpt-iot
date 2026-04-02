FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/backend/package.json apps/backend/
COPY packages/types/package.json packages/types/
RUN pnpm install --frozen-lockfile --filter @wpt/backend --filter @wpt/types

FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY packages/types/ packages/types/
COPY apps/backend/ apps/backend/
RUN pnpm --filter @wpt/types run build
RUN pnpm --filter @wpt/backend run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/backend/dist ./dist
COPY --from=builder /app/apps/backend/package.json ./
COPY --from=builder /app/apps/backend/node_modules ./node_modules
COPY --from=builder /app/packages/types/dist ./node_modules/@wpt/types/dist
COPY --from=builder /app/packages/types/package.json ./node_modules/@wpt/types/

EXPOSE 3001
CMD ["node", "dist/index.js"]
