# syntax=docker/dockerfile:1
#
# priority-scorer — hosted Knative service for the crm-support-telegram demo.
# Build context is the REPO ROOT (needed to reach the local `sdk/` `file:`
# dependency, per `integrations/http/hosted-services-api` conventions):
#
#   docker build -f demos/crm-support-telegram/priority-scorer/Dockerfile \
#     -t dev.local/priority-scorer:local .
#
# Two stages: the SDK is built from source INSIDE the image (repo-root
# `.dockerignore` excludes `**/dist` everywhere on purpose — "always
# reinstalled/rebuilt inside the image" — so `sdk/dist` is never copied from
# the host); the runtime stage then only needs the SDK's build OUTPUT (it
# ships zero runtime dependencies — `sdk/package.json` — so `sdk/node_modules`
# is not copied either).
#
# Bun runs TypeScript directly for the scorer itself (no separate build
# step) — mirrors the `oven/bun` runtime stage other services already use
# (`services/agent-scheduler-service/Dockerfile`).
#
# NEVER set PORT here — Knative injects it on the container
# (`registry/types.ts` `RegisterServiceInput.port`); `src/config.ts` reads
# `process.env.PORT`.

FROM oven/bun:1.3.14-alpine AS sdk-build
WORKDIR /app/sdk
COPY sdk/package.json sdk/tsconfig.json ./
COPY sdk/src src
RUN bun install && bun run build

FROM oven/bun:1.3.14-alpine AS runtime

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

WORKDIR /app

COPY --from=sdk-build /app/sdk/package.json sdk/package.json
COPY --from=sdk-build /app/sdk/dist sdk/dist

COPY demos/crm-support-telegram/priority-scorer/package.json demos/crm-support-telegram/priority-scorer/package.json

WORKDIR /app/demos/crm-support-telegram/priority-scorer
RUN bun install --production

COPY demos/crm-support-telegram/priority-scorer/src src

USER 1001:1001

CMD ["bun", "src/index.ts"]
