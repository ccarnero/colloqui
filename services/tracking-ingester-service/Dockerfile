# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

COPY packages packages

COPY services/tracking-ingester-service/package.json services/tracking-ingester-service/

RUN corepack enable pnpm && \
    pnpm install --ignore-scripts && \
    pnpm rebuild esbuild

FROM deps AS build
WORKDIR /app

COPY services/tracking-ingester-service/tsconfig.json services/tracking-ingester-service/
COPY services/tracking-ingester-service/src services/tracking-ingester-service/src

# tsc only emits .ts -> .js. The runtime reads ./sql/tracked-events.sql relative
# to dist/main.js (src/main.ts: new URL("./sql/tracked-events.sql", import.meta.url)),
# so the non-TS schema asset must be copied into dist alongside the compiled code.
RUN corepack enable pnpm && \
    pnpm exec tsc -p services/tracking-ingester-service/tsconfig.json && \
    cp -r services/tracking-ingester-service/src/sql services/tracking-ingester-service/dist/sql

FROM oven/bun:1.3.14-alpine AS runtime

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/services/tracking-ingester-service/node_modules /app/services/tracking-ingester-service/node_modules
COPY --from=build /app/services/tracking-ingester-service/dist /app/services/tracking-ingester-service/dist
COPY --from=build /app/services/tracking-ingester-service/package.json /app/services/tracking-ingester-service/package.json
COPY --from=build /app/services/tracking-ingester-service/tsconfig.json /app/services/tracking-ingester-service/tsconfig.json

WORKDIR /app/services/tracking-ingester-service

USER 1001:1001

EXPOSE 3000

CMD ["bun", "dist/main.js"]
