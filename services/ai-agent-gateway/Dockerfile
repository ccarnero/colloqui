# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

COPY packages packages

COPY services/ai-agent-gateway/package.json services/ai-agent-gateway/

RUN corepack enable pnpm && \
    pnpm install --ignore-scripts && \
    pnpm rebuild esbuild

FROM deps AS build
WORKDIR /app

COPY services/ai-agent-gateway/tsconfig.json services/ai-agent-gateway/
COPY services/ai-agent-gateway/src services/ai-agent-gateway/src

RUN corepack enable pnpm && \
    pnpm exec tsc -p services/ai-agent-gateway/tsconfig.json

FROM oven/bun:1.3.14-alpine AS runtime

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/services/ai-agent-gateway/node_modules /app/services/ai-agent-gateway/node_modules
COPY --from=build /app/services/ai-agent-gateway/dist /app/services/ai-agent-gateway/dist
COPY --from=build /app/services/ai-agent-gateway/package.json /app/services/ai-agent-gateway/package.json
COPY --from=build /app/services/ai-agent-gateway/tsconfig.json /app/services/ai-agent-gateway/tsconfig.json

WORKDIR /app/services/ai-agent-gateway

USER 1001:1001

EXPOSE 3000

CMD ["bun", "dist/main.js"]
