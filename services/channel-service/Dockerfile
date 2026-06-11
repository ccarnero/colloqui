# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

COPY packages packages

COPY services/channel-service/package.json services/channel-service/

RUN corepack enable pnpm && \
    pnpm install --ignore-scripts && \
    pnpm rebuild esbuild

FROM deps AS build
WORKDIR /app

COPY services/channel-service/tsconfig.json services/channel-service/
COPY services/channel-service/src services/channel-service/src

RUN corepack enable pnpm && \
    pnpm exec tsc -p services/channel-service/tsconfig.json

FROM oven/bun:1.3.14-alpine AS runtime

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/services/channel-service/node_modules /app/services/channel-service/node_modules
COPY --from=build /app/services/channel-service/dist /app/services/channel-service/dist
COPY --from=build /app/services/channel-service/package.json /app/services/channel-service/package.json
COPY --from=build /app/services/channel-service/tsconfig.json /app/services/channel-service/tsconfig.json

WORKDIR /app/services/channel-service

USER 1001:1001

EXPOSE 3000

CMD ["bun", "dist/main.js"]
