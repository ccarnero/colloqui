FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

COPY services/cache-service/package.json ./
RUN bun install

COPY services/cache-service/src ./src
COPY services/cache-service/tsconfig.json ./
RUN bun run build

FROM oven/bun:1.3-alpine

WORKDIR /app

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

USER 1001:1001

EXPOSE 3000

CMD ["bun", "run", "dist/main.js"]
