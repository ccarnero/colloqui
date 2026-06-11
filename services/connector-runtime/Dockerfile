# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

COPY packages packages

COPY services/connector-runtime/package.json services/connector-runtime/

RUN corepack enable pnpm && \
    pnpm install --ignore-scripts && \
    pnpm rebuild esbuild

FROM deps AS build
WORKDIR /app

COPY services/connector-runtime/tsconfig.json services/connector-runtime/
COPY services/connector-runtime/src services/connector-runtime/src

RUN corepack enable pnpm && \
    pnpm exec tsc -p services/connector-runtime/tsconfig.json

FROM oven/bun:1.3.14-alpine AS runtime

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/services/connector-runtime/node_modules /app/services/connector-runtime/node_modules
COPY --from=build /app/services/connector-runtime/dist /app/services/connector-runtime/dist
COPY --from=build /app/services/connector-runtime/package.json /app/services/connector-runtime/package.json
COPY --from=build /app/services/connector-runtime/tsconfig.json /app/services/connector-runtime/tsconfig.json

WORKDIR /app/services/connector-runtime

USER 1001:1001

EXPOSE 3000

CMD ["bun", "dist/worker.js"]
