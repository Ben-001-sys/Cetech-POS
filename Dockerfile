FROM node:24.21.0-bookworm-slim AS deps
WORKDIR /repo

RUN npm install --global pnpm@12.4.1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/pos-web/package.json ./apps/pos-web/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .

# These two values are intentionally PUBLIC Supabase client configuration.
# They are baked into browser-side Next.js bundles during the build.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

RUN pnpm --dir apps/pos-web build

FROM node:24.21.0-bookworm-slim AS runner
WORKDIR /repo

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder --chown=node:node /repo/apps/pos-web/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/pos-web/public ./apps/pos-web/public
COPY --from=builder --chown=node:node /repo/apps/pos-web/.next/static ./apps/pos-web/.next/static

USER node
EXPOSE 3000

CMD ["node", "apps/pos-web/server.js"]
