export {
  initTelemetry,
  initServiceTelemetry,
  shutdownTelemetry,
  getTracer,
  getMeter,
  type TelemetryOptions,
} from './telemetry';

export {
  createPinoLogger,
  PinoLoggerService,
} from './logger';

export {
  ObservabilityModule,
  OBSERVABILITY_LOGGER,
  type ObservabilityModuleOptions,
} from './observability.module';

export {
  injectTraceContext,
  extractTraceContext,
  startNatsConsumerSpan,
  startNatsProducerSpan,
} from './nats-propagation';

export {
  registerHttpMetricsHooks,
} from './http-metrics';

export {
  tracedFetch,
} from './traced-fetch';

export {
  bootstrapFastifyApp,
  registerTelemetrySigtermHandler,
  runNestFastifyServiceMain,
  type IBootstrapFastifyOptions,
} from "./bootstrap-fastify";

export {
  startSpan,
  withSpan,
  getActiveTraceId,
  getActiveSpanId,
} from './trace-utils';

export {
  envelopeLogFields,
  logWithEnvelope,
  activeOrRandomTraceId,
  type IEnvelopeLogContext,
  type IStructuredLogFields,
} from './envelope-logging';

export {
  trace,
  context,
  SpanKind,
  SpanStatusCode,
  type Span,
  type Tracer,
} from '@opentelemetry/api';
