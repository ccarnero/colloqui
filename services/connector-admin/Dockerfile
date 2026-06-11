# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

COPY packages packages

COPY services/connector-admin/package.json services/connector-admin/

RUN corepack enable pnpm && \
    pnpm install --ignore-scripts && \
    pnpm rebuild esbuild

FROM deps AS build
WORKDIR /app

COPY services/connector-admin/tsconfig.json services/connector-admin/
COPY services/connector-admin/src services/connector-admin/src

RUN corepack enable pnpm && \
    pnpm exec tsc -p services/connector-admin/tsconfig.json

FROM oven/bun:1.3.14-alpine AS runtime

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/services/connector-admin/node_modules /app/services/connector-admin/node_modules
COPY --from=build /app/services/connector-admin/dist /app/services/connector-admin/dist
COPY --from=build /app/services/connector-admin/package.json /app/services/connector-admin/package.json
COPY --from=build /app/services/connector-admin/tsconfig.json /app/services/connector-admin/tsconfig.json

WORKDIR /app/services/connector-admin

USER 1001:1001

EXPOSE 3000

CMD ["bun", "dist/main.js"]
