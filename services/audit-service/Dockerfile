# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

COPY packages packages

COPY services/audit-service/package.json services/audit-service/

RUN corepack enable pnpm && \
    pnpm install --ignore-scripts && \
    pnpm rebuild esbuild

FROM deps AS build
WORKDIR /app

COPY services/audit-service/tsconfig.json services/audit-service/
COPY services/audit-service/src services/audit-service/src

RUN corepack enable pnpm && \
    pnpm exec tsc -p services/audit-service/tsconfig.json

FROM oven/bun:1.3.14-alpine AS runtime

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/services/audit-service/node_modules /app/services/audit-service/node_modules
COPY --from=build /app/services/audit-service/dist /app/services/audit-service/dist
COPY --from=build /app/services/audit-service/package.json /app/services/audit-service/package.json
COPY --from=build /app/services/audit-service/tsconfig.json /app/services/audit-service/tsconfig.json

WORKDIR /app/services/audit-service

USER 1001:1001

EXPOSE 3000

CMD ["bun", "dist/main.js"]
