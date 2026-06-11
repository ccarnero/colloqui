# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

COPY packages packages

COPY services/proxy-service/package.json services/proxy-service/

RUN corepack enable pnpm && \
    pnpm install --ignore-scripts && \
    pnpm rebuild esbuild

FROM deps AS build
WORKDIR /app

COPY services/proxy-service/tsconfig.json services/proxy-service/
COPY services/proxy-service/src services/proxy-service/src

RUN corepack enable pnpm && \
    pnpm exec tsc -p services/proxy-service/tsconfig.json

FROM oven/bun:1.3.14-alpine AS runtime

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/services/proxy-service/node_modules /app/services/proxy-service/node_modules
COPY --from=build /app/services/proxy-service/dist /app/services/proxy-service/dist
COPY --from=build /app/services/proxy-service/package.json /app/services/proxy-service/package.json
COPY --from=build /app/services/proxy-service/tsconfig.json /app/services/proxy-service/tsconfig.json

WORKDIR /app/services/proxy-service

USER 1001:1001

EXPOSE 3000

CMD ["bun", "dist/main.js"]
