# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/frontend/package.json apps/frontend/
COPY packages/types/package.json packages/types/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @wpt/frontend --filter @wpt/types

FROM base AS builder
WORKDIR /app
# Default empty = same-origin (relative URLs). The production stack routes
# all API traffic through nginx on the same origin as the frontend, so the
# build does not need to know any hostname or IP. The ARG is retained only
# for unusual deployments where the backend runs on a different origin.
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_OUTPUT=standalone
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY --from=deps /app ./
COPY tsconfig.base.json ./
COPY packages/types/ packages/types/
COPY apps/frontend/ apps/frontend/
RUN pnpm --filter @wpt/types run build
RUN pnpm --filter @wpt/frontend run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
LABEL org.opencontainers.image.source=https://github.com/dvdmarchetto/Wpt
LABEL org.opencontainers.image.description="WPT IoT Frontend — Next.js 15 standalone"
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/public ./apps/frontend/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/messages ./apps/frontend/messages

USER nextjs
EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"
CMD ["node", "apps/frontend/server.js"]
