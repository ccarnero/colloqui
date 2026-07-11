# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

COPY packages/angular-shared /app/packages/angular-shared

COPY services/admin-console/package.json services/admin-console/

WORKDIR /app/services/admin-console

RUN corepack enable pnpm && \
    pnpm install --ignore-scripts --filter admin-console... && \
    pnpm --prefix /app/packages/angular-shared run build

COPY services/admin-console/ /app/services/admin-console/
RUN npx ng build --configuration=production

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY services/admin-console/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/services/admin-console/dist/admin-console/browser /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
