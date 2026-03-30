FROM node:22-alpine AS builder

WORKDIR /app

COPY services/admin-console/package.json services/admin-console/package-lock.json ./
RUN npm ci --prefer-offline

COPY services/admin-console/ .
RUN npx ng build --configuration=production

FROM nginx:1.27-alpine

COPY services/admin-console/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/admin-console/browser /usr/share/nginx/html

RUN rm /etc/nginx/conf.d/default.conf.bak 2>/dev/null || true && \
    addgroup -g 1001 -S app && \
    adduser -u 1001 -S app -G app && \
    chown -R app:app /usr/share/nginx/html && \
    chown -R app:app /var/cache/nginx && \
    chown -R app:app /var/log/nginx && \
    chown -R app:app /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && \
    chown app:app /var/run/nginx.pid

USER 1001:1001

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
