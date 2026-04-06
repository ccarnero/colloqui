FROM oven/bun:1.3-debian AS builder

WORKDIR /app

COPY packages/shared ./packages/shared
RUN cd packages/shared && bun install
COPY packages/observability ./packages/observability
COPY packages/database ./packages/database
RUN cd packages/database && bun install
COPY services/workflow-service/package.json ./services/workflow-service/
WORKDIR /app/services/workflow-service
RUN bun install
RUN rm -rf ../../packages/observability/node_modules/@nestjs \
  && mkdir -p ../../packages/observability/node_modules \
  && ln -sfn ../../../services/workflow-service/node_modules/@nestjs \
    ../../packages/observability/node_modules/@nestjs

COPY services/workflow-service/src ./src
COPY services/workflow-service/tsconfig.json ./
RUN bun run build

FROM oven/bun:1.3-debian

WORKDIR /app/services/workflow-service

RUN groupadd -g 1001 app && useradd -u 1001 -g app -s /bin/sh app

COPY --from=builder /app/packages/shared /app/packages/shared
COPY --from=builder /app/packages/observability /app/packages/observability
COPY --from=builder /app/packages/database /app/packages/database
COPY --from=builder /app/services/workflow-service/node_modules ./node_modules
COPY --from=builder /app/services/workflow-service/dist ./dist
COPY --from=builder /app/services/workflow-service/package.json ./
COPY --from=builder /app/services/workflow-service/tsconfig.json ./

USER 1001:1001

EXPOSE 3000

ARG ENTRYPOINT=dist/main.js
ENV ENTRYPOINT=${ENTRYPOINT}
CMD ["sh", "-c", "bun run ${ENTRYPOINT}"]
