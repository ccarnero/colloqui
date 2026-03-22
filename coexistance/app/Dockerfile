FROM oven/bun:1.3-alpine AS deps

WORKDIR /app

COPY package.json bun.lock ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json

RUN bun install --frozen-lockfile

FROM deps AS build

COPY client ./client
COPY server ./server
COPY .env.example ./.env.example

RUN cd client && bun run build

FROM oven/bun:1.3-alpine AS prod-deps

WORKDIR /app

COPY package.json bun.lock ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json

RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3-alpine

WORKDIR /app

RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/bun.lock ./bun.lock
COPY --from=prod-deps /app/client/package.json ./client/package.json
COPY --from=prod-deps /app/server/package.json ./server/package.json
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist
COPY .env.example ./.env.example

USER 1001:1001

EXPOSE 6666
EXPOSE 9229

CMD ["bun", "server/src/server.js"]
