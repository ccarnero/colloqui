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
  createNatsConsumerMetrics,
  __resetNatsConsumerMetricsCacheForTests,
  type INatsConsumerMetricsSink,
  type NatsMessageResult,
} from './nats-consumer-metrics';

export {
  createCircuitBreakerMetrics,
  __resetCircuitBreakerMetricsCacheForTests,
  type ICircuitBreakerMetricsSink,
} from './circuit-breaker-metrics';

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
  bootstrapWorkerApp,
  registerWorkerShutdownHandler,
  runNestWorkerServiceMain,
  type IBootstrapWorkerOptions,
  type IBootstrappedWorker,
} from "./bootstrap-worker";

export {
  startWorkerHealthServer,
  type IWorkerHealthServer,
} from "./worker-health-server";

export {
  serviceMode,
  isWorkerMode,
  isApiMode,
  resolveServiceName,
  __resetServiceModeCacheForTests,
  type ServiceMode,
} from "./runtime-mode";

export {
  bootstrapSplitService,
  type IBootstrapSplitServiceOptions,
} from "./bootstrap-split-service";

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
