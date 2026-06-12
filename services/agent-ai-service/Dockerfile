# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

COPY packages packages

COPY services/agent-ai-service/package.json services/agent-ai-service/

RUN corepack enable pnpm && \
    pnpm install --ignore-scripts && \
    pnpm rebuild esbuild

FROM deps AS build
WORKDIR /app

COPY services/agent-ai-service/tsconfig.json services/agent-ai-service/
COPY services/agent-ai-service/tsconfig.build.json services/agent-ai-service/
COPY services/agent-ai-service/src services/agent-ai-service/src

RUN corepack enable pnpm && \
    pnpm exec tsc -p services/agent-ai-service/tsconfig.build.json

FROM oven/bun:1.3.14-alpine AS runtime

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/services/agent-ai-service/node_modules /app/services/agent-ai-service/node_modules
COPY --from=build /app/services/agent-ai-service/dist /app/services/agent-ai-service/dist
COPY --from=build /app/services/agent-ai-service/package.json /app/services/agent-ai-service/package.json
COPY --from=build /app/services/agent-ai-service/tsconfig.json /app/services/agent-ai-service/tsconfig.json

WORKDIR /app/services/agent-ai-service

USER 1001:1001

EXPOSE 3000

CMD ["bun", "dist/main.js"]
