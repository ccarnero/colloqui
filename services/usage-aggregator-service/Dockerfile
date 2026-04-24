FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

COPY packages/shared ./packages/shared
RUN cd packages/shared && bun install
COPY packages/observability ./packages/observability
RUN cd packages/observability && bun install
COPY packages/database ./packages/database
COPY packages/testing ./packages/testing
RUN cd packages/database && bun install
COPY services/usage-aggregator-service/package.json ./services/usage-aggregator-service/
WORKDIR /app/services/usage-aggregator-service
RUN bun install

RUN rm -rf ../../packages/database/node_modules/@yoizen/shared \
  && ln -sfn ../../../shared ../../packages/database/node_modules/@yoizen/shared
RUN rm -rf ../../packages/observability/node_modules/@nestjs \
  && mkdir -p ../../packages/observability/node_modules \
  && ln -sfn ../../../services/usage-aggregator-service/node_modules/@nestjs \
    ../../packages/observability/node_modules/@nestjs

COPY services/usage-aggregator-service/src ./src
COPY services/usage-aggregator-service/tsconfig.json ./
RUN bun run build

FROM oven/bun:1.3-alpine

WORKDIR /app/services/usage-aggregator-service

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=builder /app/packages/shared /app/packages/shared
COPY --from=builder /app/packages/observability /app/packages/observability
COPY --from=builder /app/packages/database /app/packages/database
COPY --from=builder /app/packages/testing /app/packages/testing
COPY --from=builder /app/services/usage-aggregator-service/node_modules ./node_modules
COPY --from=builder /app/services/usage-aggregator-service/dist ./dist
COPY --from=builder /app/services/usage-aggregator-service/package.json ./
COPY --from=builder /app/services/usage-aggregator-service/tsconfig.json ./

USER 1001:1001

EXPOSE 3000

CMD ["bun", "run", "dist/main.js"]
