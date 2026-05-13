FROM oven/bun:1.3-debian AS builder

WORKDIR /app

COPY packages/shared ./packages/shared
RUN cd packages/shared && bun install
COPY packages/observability ./packages/observability
RUN cd packages/observability && bun install
COPY services/connector-runtime/package.json ./services/connector-runtime/
WORKDIR /app/services/connector-runtime
RUN bun install

RUN rm -rf ../../packages/observability/node_modules/@nestjs \
  && mkdir -p ../../packages/observability/node_modules \
  && ln -sfn ../../../services/connector-runtime/node_modules/@nestjs \
    ../../packages/observability/node_modules/@nestjs

COPY services/connector-runtime/src ./src
COPY services/connector-runtime/tsconfig.json ./
RUN bun run build

FROM oven/bun:1.3-debian

WORKDIR /app/services/connector-runtime

RUN groupadd -g 1001 app && useradd -u 1001 -g app -s /bin/sh app

COPY --from=builder /app/packages/shared /app/packages/shared
COPY --from=builder /app/packages/observability /app/packages/observability
COPY --from=builder /app/services/connector-runtime/node_modules ./node_modules
COPY --from=builder /app/services/connector-runtime/dist ./dist
COPY --from=builder /app/services/connector-runtime/package.json ./
COPY --from=builder /app/services/connector-runtime/tsconfig.json ./

USER 1001:1001

CMD ["bun", "run", "dist/worker.js"]
