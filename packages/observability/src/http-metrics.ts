import {
  metrics,
  trace,
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  type Span,
} from '@opentelemetry/api';

const TRACER_NAME = 'http-server';

export function registerHttpMetricsHooks(fastify: any, serviceName: string): void {
  const meter = metrics.getMeter(serviceName);
  const tracer = trace.getTracer(TRACER_NAME);

  const requestCounter = meter.createCounter('http.server.request.total', {
    description: 'Total HTTP server requests',
  });

  const requestDuration = meter.createHistogram('http.server.request.duration', {
    description: 'HTTP server request duration in milliseconds',
    unit: 'ms',
  });

  const activeRequests = meter.createUpDownCounter('http.server.active_requests', {
    description: 'Number of active HTTP requests',
  });

  fastify.addHook('onRequest', (req: any, _reply: any, done: () => void) => {
    (req as any).__otelStartTime = performance.now();
    activeRequests.add(1, { method: req.method });

    const parentCtx = propagation.extract(context.active(), req.headers);

    const span = tracer.startSpan(
      `HTTP ${req.method}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          'http.method': req.method,
          'http.url': req.url,
          'http.target': req.url.split('?')[0],
          'http.host': req.headers.host ?? '',
          'http.user_agent': req.headers['user-agent'] ?? '',
          'http.scheme': req.protocol ?? 'http',
          'net.peer.ip': req.ip,
        },
      },
      parentCtx,
    );

    const spanCtx = trace.setSpan(parentCtx, span);
    (req as any).__otelSpan = span;

    context.with(spanCtx, done);
  });

  fastify.addHook('onResponse', async (req: any, reply: any) => {
    const start = (req as any).__otelStartTime as number | undefined;
    const route = (req.routeOptions?.url ?? req.url.split('?')[0]) as string;
    const attrs = {
      method: req.method as string,
      route,
      status_code: reply.statusCode as number,
    };

    requestCounter.add(1, attrs);
    activeRequests.add(-1, { method: req.method as string });

    if (start !== undefined) {
      requestDuration.record(performance.now() - start, attrs);
    }

    const span = (req as any).__otelSpan as Span | undefined;
    if (span) {
      span.setAttribute('http.status_code', reply.statusCode);
      span.setAttribute('http.route', route);

      if (reply.statusCode >= 500) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${reply.statusCode}` });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      span.end();
    }
  });
}
