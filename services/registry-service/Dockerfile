# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

COPY packages packages

COPY services/registry-service/package.json services/registry-service/

RUN corepack enable pnpm && \
    pnpm install --ignore-scripts && \
    pnpm rebuild esbuild

FROM deps AS build
WORKDIR /app

COPY services/registry-service/tsconfig.json services/registry-service/
COPY services/registry-service/src services/registry-service/src

RUN corepack enable pnpm && \
    pnpm exec tsc -p services/registry-service/tsconfig.json

FROM oven/bun:1.3.14-alpine AS runtime

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/services/registry-service/node_modules /app/services/registry-service/node_modules
COPY --from=build /app/services/registry-service/dist /app/services/registry-service/dist
COPY --from=build /app/services/registry-service/package.json /app/services/registry-service/package.json
COPY --from=build /app/services/registry-service/tsconfig.json /app/services/registry-service/tsconfig.json

WORKDIR /app/services/registry-service

USER 1001:1001

EXPOSE 3000

CMD ["bun", "dist/main.js"]
