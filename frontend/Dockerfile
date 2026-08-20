# Phase 12: frontend image - Next.js production build using the standalone output
# (see next.config.ts), served by `node server.js`.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Baked into the client bundle at build time - defaults to http://localhost:8000.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

# Baked in at build time, like every NEXT_PUBLIC_ value. Empty by default,
# which matches the API running open; set it only when the API sets API_TOKEN.
# Being a NEXT_PUBLIC_ value it ships to the browser, so it gates casual access
# and LLM spend, not secrets.
ARG NEXT_PUBLIC_API_TOKEN=
ENV NEXT_PUBLIC_API_TOKEN=$NEXT_PUBLIC_API_TOKEN
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
