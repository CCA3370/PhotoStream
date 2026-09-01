# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24.20.0-trixie-slim

FROM ${NODE_IMAGE} AS workspace
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
COPY . .
RUN --mount=type=cache,id=photostream-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM workspace AS api-build
RUN pnpm --filter @photostream/api build && \
    pnpm --config.strict-peer-dependencies=false --filter @photostream/api deploy --prod --legacy /output/api && \
    cp -R packages/db/drizzle /output/api/drizzle

FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV MIGRATIONS_FOLDER=/app/drizzle
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tini && \
    rm -rf /var/lib/apt/lists/*
COPY --from=api-build --chown=node:node /output/api ./
USER node
EXPOSE 3001
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]

FROM workspace AS web-build
ARG API_INTERNAL_URL=http://caddy:8080
ARG MEDIA_BASE_URL=https://cdn.cloverta.top
ENV API_INTERNAL_URL=$API_INTERNAL_URL
ENV MEDIA_BASE_URL=$MEDIA_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @photostream/web build

FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tini && \
    rm -rf /var/lib/apt/lists/*
COPY --from=web-build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=node:node /workspace/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/web/server.js"]
