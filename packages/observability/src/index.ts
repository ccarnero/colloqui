export {
  initTelemetry,
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
  startSpan,
  withSpan,
  getActiveTraceId,
  getActiveSpanId,
} from './trace-utils';
