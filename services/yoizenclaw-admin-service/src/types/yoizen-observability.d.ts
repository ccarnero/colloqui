// Temporary type declarations for @yoizen/observability
// These are used until the workspace packages are properly built

declare module '@yoizen/observability' {
  import {
    type DynamicModule,
    type LoggerService,
  } from '@nestjs/common';

  export class ObservabilityModule {
    static forRoot(options: { serviceName: string }): DynamicModule;
  }

  export interface TelemetryOptions {
    serviceName: string;
    otlpEndpoint?: string;
    metricsIntervalMs?: number;
    debug?: boolean;
  }

  export function initTelemetry(options: TelemetryOptions): void;

  export function shutdownTelemetry(): Promise<void>;

  export function registerHttpMetricsHooks(
    fastify: unknown,
    serviceName: string,
  ): void;

  export class PinoLoggerService implements LoggerService {
    constructor(serviceName: string);
    log(message: unknown, ...optionalParams: unknown[]): void;
    error(message: unknown, ...optionalParams: unknown[]): void;
    warn(message: unknown, ...optionalParams: unknown[]): void;
    debug(message: unknown, ...optionalParams: unknown[]): void;
    verbose(message: unknown, ...optionalParams: unknown[]): void;
    fatal(message: unknown, ...optionalParams: unknown[]): void;
  }
}
