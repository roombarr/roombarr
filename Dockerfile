FROM oven/bun:alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN bun run build

FROM lscr.io/linuxserver/baseimage-alpine:3.21

ARG BUILD_DATE
ARG VERSION

LABEL build_version="Roombarr version: ${VERSION} build-date: ${BUILD_DATE}"
LABEL org.opencontainers.image.title="Roombarr"
LABEL org.opencontainers.image.description="Rule-based media cleanup engine"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.source="https://github.com/jacksonblankenship/roombarr"
LABEL org.opencontainers.image.url="https://github.com/jacksonblankenship/roombarr"
LABEL org.opencontainers.image.licenses="GPL-2.0-only"
LABEL org.opencontainers.image.authors="jacksonblankenship"
LABEL org.opencontainers.image.vendor="jacksonblankenship"
LABEL org.opencontainers.image.documentation="https://github.com/jacksonblankenship/roombarr"

RUN set -eux; \
    ARCH="$(uname -m)"; \
    case "${ARCH}" in \
      x86_64)  BUN_ARCH="x64-musl" ;; \
      aarch64) BUN_ARCH="aarch64-musl" ;; \
      *) echo "Unsupported architecture: ${ARCH}" && exit 1 ;; \
    esac; \
    wget -qO- "https://github.com/oven-sh/bun/releases/latest/download/bun-linux-${BUN_ARCH}.zip" > /tmp/bun.zip && \
    unzip -q /tmp/bun.zip -d /tmp/bun && \
    mv /tmp/bun/bun-linux-${BUN_ARCH}/bun /usr/local/bin/bun && \
    chmod +x /usr/local/bin/bun && \
    rm -rf /tmp/bun /tmp/bun.zip && \
    apk add --no-cache libgcc libstdc++

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY drizzle ./drizzle

COPY root/ /

RUN chmod +x /etc/s6-overlay/s6-rc.d/*/run

ENV LSIO_FIRST_PRIORITY=false
ENV NODE_ENV=production
ENV CONFIG_PATH=/config/roombarr.yml

EXPOSE 3000
VOLUME /config

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1
