FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/frontend/package.json apps/frontend/
COPY packages/types/package.json packages/types/
RUN pnpm install --frozen-lockfile --filter @wpt/frontend --filter @wpt/types

FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY packages/types/ packages/types/
COPY apps/frontend/ apps/frontend/
RUN pnpm --filter @wpt/types run build
RUN pnpm --filter @wpt/frontend run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/apps/frontend/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
