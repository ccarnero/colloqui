FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

COPY packages/shared ./packages/shared
COPY packages/observability ./packages/observability
COPY packages/database ./packages/database
RUN cd packages/database && bun install
COPY services/yoizenclaw-admin-service/package.json \
  ./services/yoizenclaw-admin-service/
WORKDIR /app/services/yoizenclaw-admin-service
RUN bun install

COPY services/yoizenclaw-admin-service/src ./src
COPY services/yoizenclaw-admin-service/data ./data
COPY services/yoizenclaw-admin-service/tsconfig.json \
  services/yoizenclaw-admin-service/tsconfig.build.json ./
RUN bun run build

FROM oven/bun:1.3-alpine

WORKDIR /app/services/yoizenclaw-admin-service

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=builder /app/packages/shared /app/packages/shared
COPY --from=builder /app/packages/observability /app/packages/observability
COPY --from=builder /app/packages/database /app/packages/database
COPY --from=builder /app/services/yoizenclaw-admin-service/node_modules \
  ./node_modules
COPY --from=builder /app/services/yoizenclaw-admin-service/dist ./dist
COPY --from=builder /app/services/yoizenclaw-admin-service/data ./data
COPY --from=builder /app/services/yoizenclaw-admin-service/package.json ./
COPY --from=builder /app/services/yoizenclaw-admin-service/tsconfig.json ./

USER 1001:1001

EXPOSE 3000

CMD ["bun", "run", "dist/main.js"]
