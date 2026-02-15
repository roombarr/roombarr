FROM oven/bun:alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN bun run build

FROM oven/bun:alpine
WORKDIR /app

RUN addgroup -S roombarr && adduser -S roombarr -G roombarr
RUN mkdir -p /data && chown -R roombarr:roombarr /data

COPY --from=builder --chown=roombarr:roombarr /app/dist ./dist
COPY --from=builder --chown=roombarr:roombarr /app/node_modules ./node_modules
COPY --from=builder --chown=roombarr:roombarr /app/package.json ./

USER roombarr

ENV NODE_ENV=production
ENV CONFIG_PATH=/config/roombarr.yml
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["bun", "run", "dist/main.js"]
