# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

COPY packages packages

COPY services/usage-aggregator-service/package.json services/usage-aggregator-service/

RUN corepack enable pnpm && \
    pnpm install --ignore-scripts && \
    pnpm rebuild esbuild

FROM deps AS build
WORKDIR /app

COPY services/usage-aggregator-service/tsconfig.json services/usage-aggregator-service/
COPY services/usage-aggregator-service/src services/usage-aggregator-service/src

RUN corepack enable pnpm && \
    pnpm exec tsc -p services/usage-aggregator-service/tsconfig.json

FROM oven/bun:1.3.14-alpine AS runtime

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/services/usage-aggregator-service/node_modules /app/services/usage-aggregator-service/node_modules
COPY --from=build /app/services/usage-aggregator-service/dist /app/services/usage-aggregator-service/dist
COPY --from=build /app/services/usage-aggregator-service/package.json /app/services/usage-aggregator-service/package.json
COPY --from=build /app/services/usage-aggregator-service/tsconfig.json /app/services/usage-aggregator-service/tsconfig.json

WORKDIR /app/services/usage-aggregator-service

USER 1001:1001

EXPOSE 3000

CMD ["bun", "dist/main.js"]
