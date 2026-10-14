FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251 AS novnc
RUN apt-get update && apt-get install -y --no-install-recommends novnc \
  && rm -rf /var/lib/apt/lists/*
COPY --chmod=644 infra/sandboxes/computer/embed.html /usr/share/novnc/embed.html
COPY --chmod=644 infra/sandboxes/computer/clipboard-bridge.js /usr/share/novnc/clipboard-bridge.js
COPY --chmod=644 infra/sandboxes/computer/mobile-keyboard.js /usr/share/novnc/mobile-keyboard.js

FROM node:22-bookworm@sha256:0557ac14e0d45d02ed563067b82856ca5e7aa3437fa28d98d4350ea9c3d9494a
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate && chmod -R a+rX /opt/corepack
WORKDIR /app
# Manifests land before the source tree so editing a source file does not re-run the
# install. pnpm gets a partial workspace: every package listed in pnpm-workspace.yaml
# needs its manifest below, or --frozen-lockfile fails. The store is a cache mount, so
# a lockfile change reuses whatever was already downloaded.
COPY --chmod=755 package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --chmod=755 patches patches
COPY --chmod=755 apps/api/package.json apps/api/
COPY --chmod=755 apps/desktop/package.json apps/desktop/
COPY --chmod=755 apps/mobile/package.json apps/mobile/
COPY --chmod=755 apps/web/package.json apps/web/
COPY --chmod=755 apps/worker/package.json apps/worker/
COPY --chmod=755 apps/www/package.json apps/www/
COPY --chmod=755 packages/adapter-kit/package.json packages/adapter-kit/
COPY --chmod=755 packages/adapters/package.json packages/adapters/
COPY --chmod=755 packages/auth/package.json packages/auth/
COPY --chmod=755 packages/chat-ui/package.json packages/chat-ui/
COPY --chmod=755 packages/contracts/package.json packages/contracts/
COPY --chmod=755 packages/core/package.json packages/core/
COPY --chmod=755 packages/db/package.json packages/db/
COPY --chmod=755 packages/logging/package.json packages/logging/
COPY --chmod=755 packages/memory/package.json packages/memory/
COPY --chmod=755 packages/testkit/package.json packages/testkit/
COPY --chmod=755 packages/ui-tokens/package.json packages/ui-tokens/
COPY --chmod=755 packages/ui-web/package.json packages/ui-web/
COPY --chmod=755 infra/sandboxes/supervisor/package.json infra/sandboxes/supervisor/
COPY --chmod=755 infra/updater/package.json infra/updater/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --store-dir=/pnpm/store
# Normalize modes: a restrictive host umask (e.g. 077 on hardened hosts) would otherwise
# leave the copied tree unreadable to USER node at runtime.
COPY --chmod=755 . .
RUN pnpm --filter @rakazo/db generate
ARG SCREEN_VIEWER_STATIC=
ENV SCREEN_VIEWER_STATIC=$SCREEN_VIEWER_STATIC
ARG RAKAZO_BRAND_DIR=
ENV RAKAZO_BRAND_DIR=$RAKAZO_BRAND_DIR
RUN RAKAZO_ALLOW_DEV_SECRETS=1 pnpm --filter @rakazo/web build
COPY --from=novnc /usr/share/novnc /app/apps/web/novnc-static
RUN install -d -m 750 -o node -g node /data /app/apps/web/node_modules/.vite-temp
ARG GIT_SHA
ENV NODE_ENV=production
ENV GIT_SHA=$GIT_SHA
ENV COREPACK_ENABLE_NETWORK=0
EXPOSE 3100 5173 7091
USER node
CMD ["pnpm", "--filter", "@rakazo/api", "start"]
