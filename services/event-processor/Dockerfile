FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

COPY packages/shared ./packages/shared
COPY services/event-processor/package.json ./services/event-processor/
WORKDIR /app/services/event-processor
RUN bun install

COPY services/event-processor/src ./src
COPY services/event-processor/tsconfig.json ./
RUN bun run build

FROM oven/bun:1.3-alpine

WORKDIR /app/services/event-processor

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=builder /app/packages/shared /app/packages/shared
COPY --from=builder /app/services/event-processor/node_modules ./node_modules
COPY --from=builder /app/services/event-processor/dist ./dist
COPY --from=builder /app/services/event-processor/package.json ./

USER 1001:1001

EXPOSE 3000

CMD ["bun", "run", "dist/main.js"]
