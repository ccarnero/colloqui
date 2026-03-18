import { initTelemetry } from '@yoizen/observability';

initTelemetry({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'registry-service',
});
