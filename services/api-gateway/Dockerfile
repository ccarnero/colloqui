# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

COPY packages packages

COPY services/api-gateway/package.json services/api-gateway/

RUN corepack enable pnpm && \
    pnpm install --ignore-scripts && \
    pnpm rebuild esbuild

FROM deps AS build
WORKDIR /app

COPY services/api-gateway/tsconfig.json services/api-gateway/
COPY services/api-gateway/src services/api-gateway/src

RUN corepack enable pnpm && \
    pnpm exec tsc -p services/api-gateway/tsconfig.json

FROM oven/bun:1.3.14-alpine AS runtime

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/services/api-gateway/node_modules /app/services/api-gateway/node_modules
COPY --from=build /app/services/api-gateway/dist /app/services/api-gateway/dist
COPY --from=build /app/services/api-gateway/package.json /app/services/api-gateway/package.json
COPY --from=build /app/services/api-gateway/tsconfig.json /app/services/api-gateway/tsconfig.json

WORKDIR /app/services/api-gateway

USER 1001:1001

EXPOSE 3000

CMD ["bun", "dist/main.js"]
