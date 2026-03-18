FROM oven/bun:1.3-debian AS builder

WORKDIR /app

COPY packages/shared ./packages/shared
COPY packages/observability ./packages/observability
COPY services/workflow-http-worker/package.json ./services/workflow-http-worker/
WORKDIR /app/services/workflow-http-worker
RUN bun install

COPY services/workflow-http-worker/src ./src
COPY services/workflow-http-worker/tsconfig.json ./
RUN bun run build

FROM oven/bun:1.3-debian

WORKDIR /app/services/workflow-http-worker

RUN groupadd -g 1001 app && useradd -u 1001 -g app -s /bin/sh app

COPY --from=builder /app/packages/shared /app/packages/shared
COPY --from=builder /app/packages/observability /app/packages/observability
COPY --from=builder /app/services/workflow-http-worker/node_modules ./node_modules
COPY --from=builder /app/services/workflow-http-worker/dist ./dist
COPY --from=builder /app/services/workflow-http-worker/package.json ./

USER 1001:1001

CMD ["bun", "run", "dist/worker.js"]
