FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

COPY packages/shared ./packages/shared
COPY packages/observability ./packages/observability
COPY services/channel-service/package.json ./services/channel-service/
WORKDIR /app/services/channel-service
RUN bun install

COPY services/channel-service/src ./src
COPY services/channel-service/tsconfig.json ./
RUN bun run build

FROM oven/bun:1.3-alpine

WORKDIR /app/services/channel-service

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=builder /app/packages/shared /app/packages/shared
COPY --from=builder /app/packages/observability /app/packages/observability
COPY --from=builder /app/services/channel-service/node_modules ./node_modules
COPY --from=builder /app/services/channel-service/dist ./dist
COPY --from=builder /app/services/channel-service/package.json ./

USER 1001:1001

EXPOSE 3000

CMD ["bun", "run", "dist/main.js"]
