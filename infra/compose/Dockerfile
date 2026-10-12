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
# Normalize modes: a restrictive host umask (e.g. 077 on hardened hosts) would otherwise
# leave the copied tree unreadable to USER node at runtime.
COPY --chmod=755 . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @rakazo/db generate
ARG SCREEN_VIEWER_STATIC=
ENV SCREEN_VIEWER_STATIC=$SCREEN_VIEWER_STATIC
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
