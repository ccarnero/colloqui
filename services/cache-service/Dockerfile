FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

COPY packages/observability ./packages/observability
COPY packages/database ./packages/database
RUN cd packages/database && bun install
COPY services/cache-service/package.json ./services/cache-service/
WORKDIR /app/services/cache-service
RUN bun install

COPY services/cache-service/src ./src
COPY services/cache-service/tsconfig.json ./
RUN bun run build

FROM oven/bun:1.3-alpine

WORKDIR /app/services/cache-service

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=builder /app/packages/observability /app/packages/observability
COPY --from=builder /app/packages/database /app/packages/database
COPY --from=builder /app/services/cache-service/node_modules ./node_modules
COPY --from=builder /app/services/cache-service/dist ./dist
COPY --from=builder /app/services/cache-service/package.json ./

USER 1001:1001

EXPOSE 3000

CMD ["bun", "run", "dist/main.js"]
