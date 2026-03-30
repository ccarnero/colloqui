// Temporary module for @yoizen/observability
// These are used until the workspace packages are properly built

import {
  Module,
  type DynamicModule,
  type LoggerService,
} from '@nestjs/common';

@Module({})
export class ObservabilityModule {
  static forRoot(_options: { serviceName: string }): DynamicModule {
    return {
      module: ObservabilityModule,
      providers: [],
      exports: [],
    };
  }
}

export interface TelemetryOptions {
  serviceName: string;
  otlpEndpoint?: string;
  metricsIntervalMs?: number;
  debug?: boolean;
}

export function initTelemetry(_options: TelemetryOptions): void {}

export async function shutdownTelemetry(): Promise<void> {}

export function registerHttpMetricsHooks(
  _fastify: unknown,
  _serviceName: string,
): void {}

export class PinoLoggerService implements LoggerService {
  constructor(_serviceName: string) {}

  log(_message: unknown, ..._optionalParams: unknown[]): void {}

  error(_message: unknown, ..._optionalParams: unknown[]): void {}

  warn(_message: unknown, ..._optionalParams: unknown[]): void {}

  debug(_message: unknown, ..._optionalParams: unknown[]): void {}

  verbose(_message: unknown, ..._optionalParams: unknown[]): void {}

  fatal(_message: unknown, ..._optionalParams: unknown[]): void {}
}
