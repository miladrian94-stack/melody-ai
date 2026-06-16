# syntax=docker.io/docker/dockerfile:1

FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json ./
RUN npm install

FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN mkdir -p public
RUN ls -la
RUN ls -la prisma
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

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
