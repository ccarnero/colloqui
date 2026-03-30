import { initTelemetry } from '@yoizen/observability';

initTelemetry({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'yoizenclaw-admin-service',
});
