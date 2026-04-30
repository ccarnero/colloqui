import { context, propagation, trace, metrics, diag, DiagLogLevel } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resolveServiceName } from './runtime-mode';

export interface TelemetryOptions {
  serviceName: string;
  otlpEndpoint?: string;
  metricsIntervalMs?: number;
  debug?: boolean;
}

let tracerProvider: BasicTracerProvider | null = null;
let meterProvider: MeterProvider | null = null;

export function initTelemetry(options: TelemetryOptions): void {
  if (tracerProvider) return;

  const {
    serviceName,
    otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318',
    metricsIntervalMs = 30_000,
    debug = false,
  } = options;

  if (debug) {
    diag.setLogger(
      { error: console.error, warn: console.warn, info: console.info, debug: console.debug, verbose: console.debug },
      DiagLogLevel.INFO,
    );
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
  });

  const contextManager = new AsyncLocalStorageContextManager();
  context.setGlobalContextManager(contextManager);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` }),
      ),
    ],
  });
  trace.setGlobalTracerProvider(tracerProvider);

  meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${otlpEndpoint}/v1/metrics` }),
        exportIntervalMillis: metricsIntervalMs,
      }),
    ],
  });
  metrics.setGlobalMeterProvider(meterProvider);
}

/**
 * Initializes telemetry for a service. The effective service name is resolved
 * via `resolveServiceName`, which prefers `OTEL_SERVICE_NAME` (set by manifests)
 * and falls back to `<base>-<mode>` (mode driven by `SERVICE_MODE`) so split
 * services emit role-specific metrics/traces (`audit-service-api`,
 * `audit-service-worker`, ...) even when the env var isn't pre-set.
 */
export function initServiceTelemetry(defaultServiceName: string): void {
  initTelemetry({
    serviceName: resolveServiceName(defaultServiceName),
  });
}

export async function shutdownTelemetry(): Promise<void> {
  const promises: Promise<void>[] = [];
  if (tracerProvider) {
    promises.push(tracerProvider.shutdown());
    tracerProvider = null;
  }
  if (meterProvider) {
    promises.push(meterProvider.shutdown());
    meterProvider = null;
  }
  await Promise.all(promises);
}

export function getTracer(name: string) {
  return trace.getTracer(name);
}

export function getMeter(name: string) {
  return metrics.getMeter(name);
}
