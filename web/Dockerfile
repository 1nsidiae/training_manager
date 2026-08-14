# De buildcontext is de repo-root, niet ./web. Reden: `web/lib/training-load.ts`
# importeert `../../tm_sync/training_load_model.json`, het model dat de Python-
# kant en de web-kant delen. Door /repo/web en /repo/tm_sync naast elkaar te
# zetten heeft de container exact dezelfde mappenverhouding als je laptop, en
# lost dat relatieve pad hier op precies dezelfde manier op.

FROM node:22-alpine AS dependencies
WORKDIR /repo/web
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /repo/web
RUN corepack enable
COPY --from=dependencies /repo/web/node_modules ./node_modules
COPY web/ ./
# Alleen dit ene bestand uit tm_sync; de rest van de Python-code hoort niet in
# een Node-image en staat in web/Dockerfile.dockerignore uitgesloten.
COPY tm_sync/training_load_model.json /repo/tm_sync/training_load_model.json
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
# Doordat outputFileTracingRoot de repo-root is, nestelt de standalone-build
# zichzelf onder web/. Die indeling houden we hier aan; server.js staat dus in
# /app/web en niet in /app.
COPY --from=builder --chown=nextjs:nodejs /repo/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/web/.next/static ./web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/web/public ./web/public
USER nextjs
WORKDIR /app/web
EXPOSE 3000
CMD ["node", "server.js"]
