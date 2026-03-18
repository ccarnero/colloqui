import {
  trace,
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
} from '@opentelemetry/api';

const TRACER_NAME = 'http-client';

export async function tracedFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const tracer = trace.getTracer(TRACER_NAME);

  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');

  const span = tracer.startSpan(`HTTP ${method}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      'http.method': method,
      'http.url': url,
    },
  });

  const spanCtx = trace.setSpan(context.active(), span);

  const headers: Record<string, string> = {};
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => { headers[k] = v; });
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) headers[k] = v;
    } else {
      Object.assign(headers, init.headers);
    }
  }

  propagation.inject(spanCtx, headers);

  const mergedInit: RequestInit = { ...init, headers };

  try {
    const response = await context.with(spanCtx, () => fetch(input, mergedInit));

    span.setAttribute('http.status_code', response.status);

    if (response.status >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${response.status}` });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    return response;
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
    span.recordException(err instanceof Error ? err : new Error(String(err)));
    throw err;
  } finally {
    span.end();
  }
}
