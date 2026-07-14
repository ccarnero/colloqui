# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

COPY packages packages

COPY services/provisioning-service/package.json services/provisioning-service/

RUN corepack enable pnpm && \
    pnpm install --ignore-scripts && \
    pnpm rebuild esbuild

FROM deps AS build
WORKDIR /app

COPY services/provisioning-service/tsconfig.json services/provisioning-service/
COPY services/provisioning-service/tsconfig.build.json services/provisioning-service/
COPY services/provisioning-service/src services/provisioning-service/src

RUN corepack enable pnpm && \
    pnpm exec tsc -p services/provisioning-service/tsconfig.build.json

FROM oven/bun:1.3.14-alpine AS runtime

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/services/provisioning-service/node_modules /app/services/provisioning-service/node_modules
COPY --from=build /app/services/provisioning-service/dist /app/services/provisioning-service/dist
# tsc does not copy non-TS assets; schema-initializer reads this at runtime from dist/
COPY --from=build /app/services/provisioning-service/src/schema /app/services/provisioning-service/dist/schema
COPY --from=build /app/services/provisioning-service/package.json /app/services/provisioning-service/package.json
COPY --from=build /app/services/provisioning-service/tsconfig.json /app/services/provisioning-service/tsconfig.json

WORKDIR /app/services/provisioning-service

USER 1001:1001

EXPOSE 3000

CMD ["bun", "dist/main.js"]
