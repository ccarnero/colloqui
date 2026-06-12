# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

COPY packages packages

COPY services/workflow-service/package.json services/workflow-service/

RUN corepack enable pnpm && \
    pnpm install --ignore-scripts && \
    pnpm rebuild esbuild

FROM deps AS build
WORKDIR /app

COPY services/workflow-service/tsconfig.json services/workflow-service/
COPY services/workflow-service/src services/workflow-service/src

RUN corepack enable pnpm && \
    pnpm exec tsc -p services/workflow-service/tsconfig.json

FROM oven/bun:1.3.14-slim AS runtime

RUN groupadd --gid 1001 app && useradd --uid 1001 --gid 1001 --no-create-home --shell /usr/sbin/nologin app

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/services/workflow-service/node_modules /app/services/workflow-service/node_modules
COPY --from=build /app/services/workflow-service/dist /app/services/workflow-service/dist
COPY --from=build /app/services/workflow-service/package.json /app/services/workflow-service/package.json
COPY --from=build /app/services/workflow-service/tsconfig.json /app/services/workflow-service/tsconfig.json

WORKDIR /app/services/workflow-service

USER 1001:1001

EXPOSE 3000

CMD ["bun", "dist/main.js"]
