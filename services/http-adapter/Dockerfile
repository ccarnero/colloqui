FROM oven/bun:1.3-debian AS builder

WORKDIR /app

COPY packages/shared ./packages/shared
RUN cd packages/shared && bun install
COPY packages/observability ./packages/observability
RUN cd packages/observability && bun install
COPY services/http-adapter/package.json ./services/http-adapter/
WORKDIR /app/services/http-adapter
RUN bun install

RUN rm -rf ../../packages/observability/node_modules/@nestjs \
  && mkdir -p ../../packages/observability/node_modules \
  && ln -sfn ../../../services/http-adapter/node_modules/@nestjs \
    ../../packages/observability/node_modules/@nestjs

COPY services/http-adapter/src ./src
COPY services/http-adapter/tsconfig.json ./
RUN bun run build

FROM oven/bun:1.3-debian

WORKDIR /app/services/http-adapter

RUN groupadd -g 1001 app && useradd -u 1001 -g app -s /bin/sh app

COPY --from=builder /app/packages/shared /app/packages/shared
COPY --from=builder /app/packages/observability /app/packages/observability
COPY --from=builder /app/services/http-adapter/node_modules ./node_modules
COPY --from=builder /app/services/http-adapter/dist ./dist
COPY --from=builder /app/services/http-adapter/package.json ./
COPY --from=builder /app/services/http-adapter/tsconfig.json ./

USER 1001:1001

CMD ["bun", "run", "dist/worker.js"]
