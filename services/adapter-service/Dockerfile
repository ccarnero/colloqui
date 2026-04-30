FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

COPY packages/shared ./packages/shared
RUN cd packages/shared && bun install
COPY packages/observability ./packages/observability
RUN cd packages/observability && bun install
COPY packages/database ./packages/database
COPY packages/testing ./packages/testing
RUN cd packages/database && bun install
COPY services/adapter-service/package.json ./services/adapter-service/
WORKDIR /app/services/adapter-service
RUN bun install

# Fix: bun install at service level corrupts packages/database/node_modules/@yoizen/shared
# (file: deps with nested installs). Re-create the symlink so tsc resolves @yoizen/shared
# from packages/database/src/*.ts.
RUN rm -rf ../../packages/database/node_modules/@yoizen/shared \
  && ln -sfn ../../../shared ../../packages/database/node_modules/@yoizen/shared
RUN rm -rf ../../packages/observability/node_modules/@nestjs \
  && mkdir -p ../../packages/observability/node_modules \
  && ln -sfn ../../../services/adapter-service/node_modules/@nestjs \
    ../../packages/observability/node_modules/@nestjs

COPY services/adapter-service/src ./src
COPY services/adapter-service/tsconfig.json ./
RUN bun run build

FROM oven/bun:1.3-alpine

WORKDIR /app/services/adapter-service

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=builder /app/packages/shared /app/packages/shared
COPY --from=builder /app/packages/observability /app/packages/observability
COPY --from=builder /app/packages/database /app/packages/database
COPY --from=builder /app/packages/testing /app/packages/testing
COPY --from=builder /app/services/adapter-service/node_modules ./node_modules
COPY --from=builder /app/services/adapter-service/dist ./dist
COPY --from=builder /app/services/adapter-service/package.json ./
COPY --from=builder /app/services/adapter-service/tsconfig.json ./

USER 1001:1001

EXPOSE 3000

CMD ["bun", "run", "dist/main.js"]
