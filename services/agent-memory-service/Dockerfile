# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

COPY packages packages

COPY services/agent-memory-service/package.json services/agent-memory-service/

RUN corepack enable pnpm && \
    pnpm install --ignore-scripts && \
    pnpm rebuild esbuild

FROM deps AS build
WORKDIR /app

COPY services/agent-memory-service/tsconfig.json services/agent-memory-service/
COPY services/agent-memory-service/tsconfig.build.json services/agent-memory-service/
COPY services/agent-memory-service/src services/agent-memory-service/src

RUN corepack enable pnpm && \
    pnpm exec tsc -p services/agent-memory-service/tsconfig.build.json

FROM oven/bun:1.3.14-alpine AS runtime

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/services/agent-memory-service/node_modules /app/services/agent-memory-service/node_modules
COPY --from=build /app/services/agent-memory-service/dist /app/services/agent-memory-service/dist
# tsc does not copy non-TS assets; schema-initializer reads this at runtime from dist/
COPY --from=build /app/services/agent-memory-service/src/schema /app/services/agent-memory-service/dist/schema
COPY --from=build /app/services/agent-memory-service/package.json /app/services/agent-memory-service/package.json
COPY --from=build /app/services/agent-memory-service/tsconfig.json /app/services/agent-memory-service/tsconfig.json

WORKDIR /app/services/agent-memory-service

USER 1001:1001

EXPOSE 3000

CMD ["bun", "dist/main.js"]
