FROM oven/bun:1.1-alpine AS runtime

WORKDIR /app

COPY tests/stress/lib/ /app/lib/
COPY tests/stress/sink/ /app/sink/

ENV STRESS_SINK_PORT=8080
ENV STRESS_SINK_OUTPUT=/var/log/stress/sink.jsonl

RUN mkdir -p /var/log/stress && chown -R bun:bun /var/log/stress

USER bun

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["bun", "run", "/app/sink/server.ts"]
