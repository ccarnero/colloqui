import {
  context,
  propagation,
  trace,
  SpanKind,
  type Context,
  type TextMapGetter,
  type TextMapSetter,
} from '@opentelemetry/api';

interface NatsHeaders {
  keys(): string[];
  values(key: string): string[];
  get(key: string): string;
  set(key: string, value: string): void;
}

const natsGetter: TextMapGetter<NatsHeaders> = {
  keys(carrier) {
    return carrier.keys();
  },
  get(carrier, key) {
    const values = carrier.values(key);
    return values.length > 0 ? values[0] : undefined;
  },
};

const natsSetter: TextMapSetter<NatsHeaders> = {
  set(carrier, key, value) {
    carrier.set(key, value);
  },
};

export function injectTraceContext(headers: NatsHeaders): void {
  propagation.inject(context.active(), headers, natsSetter);
}

export function extractTraceContext(headers: NatsHeaders): Context {
  return propagation.extract(context.active(), headers, natsGetter);
}

export function startNatsConsumerSpan(
  tracerName: string,
  operationName: string,
  headers: NatsHeaders,
) {
  const parentContext = extractTraceContext(headers);
  const tracer = trace.getTracer(tracerName);
  const span = tracer.startSpan(
    operationName,
    { kind: SpanKind.CONSUMER },
    parentContext,
  );
  const spanContext = trace.setSpan(parentContext, span);
  return { span, context: spanContext };
}

export function startNatsProducerSpan(
  tracerName: string,
  operationName: string,
  headers: NatsHeaders,
) {
  const tracer = trace.getTracer(tracerName);
  const span = tracer.startSpan(operationName, { kind: SpanKind.PRODUCER });
  const spanContext = trace.setSpan(context.active(), span);
  propagation.inject(spanContext, headers, natsSetter);
  return { span, context: spanContext };
}
