import { trace, context, SpanKind, SpanStatusCode, type Span } from '@opentelemetry/api';

export function startSpan(tracerName: string, spanName: string, kind = SpanKind.INTERNAL): Span {
  return trace.getTracer(tracerName).startSpan(spanName, { kind });
}

export async function withSpan<T>(
  tracerName: string,
  spanName: string,
  fn: (span: Span) => Promise<T>,
  kind = SpanKind.INTERNAL,
): Promise<T> {
  const tracer = trace.getTracer(tracerName);
  const span = tracer.startSpan(spanName, { kind });
  const ctx = trace.setSpan(context.active(), span);

  try {
    const result = await context.with(ctx, () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
    span.recordException(err instanceof Error ? err : new Error(String(err)));
    throw err;
  } finally {
    span.end();
  }
}

export function getActiveTraceId(): string | undefined {
  const span = trace.getSpan(context.active());
  if (!span) return undefined;
  const ctx = span.spanContext();
  if (ctx.traceId === '00000000000000000000000000000000') return undefined;
  return ctx.traceId;
}

export function getActiveSpanId(): string | undefined {
  const span = trace.getSpan(context.active());
  if (!span) return undefined;
  return span.spanContext().spanId;
}
