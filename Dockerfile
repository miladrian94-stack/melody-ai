# syntax=docker.io/docker/dockerfile:1

FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

# ✅ FIX: the original Dockerfile copied each subfolder of Backend/
# individually (Backend/app, Backend/lib, Backend/services, ...) with one
# `COPY` line per folder, FLATTENING each into the container's /app root —
# except Backend/enterprise, which was copied to ./Backend/enterprise,
# preserving its prefix. This inconsistency is why this codebase's `@/`
# alias resolves `@/lib/...` one way and `@/Backend/enterprise/...`
# another way, and it meant every NEW top-level folder added under Backend/
# (domains/, application/, infrastructure/ — added in this refactor) would
# silently NOT be copied into the image at all unless someone remembered to
# add another COPY line here. That's the root cause `next.config.js`'s
# `typescript: { ignoreBuildErrors: true }` was masking: type errors from
# files that exist on disk locally but don't exist in the actual build
# context were being silently ignored rather than fixed.
#
# Fix: copy the ENTIRE Backend/ directory as ./Backend (preserving the
# prefix, matching the enterprise/ precedent that already worked), and
# additionally copy app/ to the conventional Next.js root location so
# routing still works. Every `@/Backend/...` import (this refactor's
# convention going forward) now resolves automatically for any future
# folder added under Backend/, with no Dockerfile change required.
COPY Backend ./Backend
COPY Backend/app ./app
COPY Backend/config ./config
COPY Backend/components ./components
COPY Backend/lib ./lib
COPY Backend/middleware ./middleware
COPY Backend/services ./services
COPY prisma ./prisma
COPY package.json ./
COPY next.config.js ./
COPY tsconfig.json ./

RUN mkdir -p public
RUN npx prisma generate --schema=./prisma/schema.prisma
RUN npm run build

FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
RUN mkdir -p public

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
