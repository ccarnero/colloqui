FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

COPY packages/shared ./packages/shared
RUN cd packages/shared && bun install
COPY packages/observability ./packages/observability
RUN cd packages/observability && bun install
COPY packages/database ./packages/database
RUN cd packages/database && bun install
COPY services/ai-agent-gateway/package.json \
  ./services/ai-agent-gateway/
WORKDIR /app/services/ai-agent-gateway
RUN bun install

# Recreate workspace links after nested installs so TypeScript resolves
# shared/database dependencies consistently during the image build.
RUN rm -rf ../../packages/database/node_modules/@yoizen/shared \
  && ln -sfn ../../../shared ../../packages/database/node_modules/@yoizen/shared
RUN rm -rf ../../packages/observability/node_modules/@nestjs \
  && mkdir -p ../../packages/observability/node_modules \
  && ln -sfn ../../../services/ai-agent-gateway/node_modules/@nestjs \
    ../../packages/observability/node_modules/@nestjs

COPY services/ai-agent-gateway/src ./src
COPY services/ai-agent-gateway/tsconfig.json ./
RUN bun run build

FROM oven/bun:1.3-alpine

WORKDIR /app/services/ai-agent-gateway

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=builder /app/packages/shared /app/packages/shared
COPY --from=builder /app/packages/observability /app/packages/observability
COPY --from=builder /app/packages/database /app/packages/database
COPY --from=builder /app/services/ai-agent-gateway/node_modules ./node_modules
COPY --from=builder /app/services/ai-agent-gateway/dist ./dist
COPY --from=builder /app/services/ai-agent-gateway/package.json ./
COPY --from=builder /app/services/ai-agent-gateway/tsconfig.json ./

USER 1001:1001

EXPOSE 3000

CMD ["bun", "run", "dist/main.js"]
