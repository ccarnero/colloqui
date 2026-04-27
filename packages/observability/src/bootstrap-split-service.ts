import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { INestApplicationContext } from "@nestjs/common";
import {
  bootstrapFastifyApp,
  registerTelemetrySigtermHandler,
  type IBootstrapFastifyOptions,
} from "./bootstrap-fastify";
import {
  bootstrapWorkerApp,
  registerWorkerShutdownHandler,
} from "./bootstrap-worker";
import { isWorkerMode, serviceMode } from "./runtime-mode";
import { PinoLoggerService } from "./logger";

export interface IBootstrapSplitServiceOptions {
  /**
   * Logical service name (e.g. "audit-service"). The actual OTEL service name
   * is derived as `<baseServiceName>-<mode>` so traces/metrics/logs remain
   * partitioned per role.
   */
  baseServiceName: string;
  module: unknown;
  port: number;
  /** Forwarded to bootstrapFastifyApp when SERVICE_MODE=api. */
  apiOptions?: Pick<
    IBootstrapFastifyOptions,
    "withValidationPipe" | "fastifyAdapterOptions" | "nestApplicationOptions"
  >;
}

/**
 * Single entry point for split (api/worker) services. Selects bootstrap path
 * based on `SERVICE_MODE`:
 * - `api`    → Fastify + HTTP listen on options.port
 * - `worker` → Nest standalone context (no HTTP)
 *
 * Returns a discriminated union so callers can introspect mode if needed.
 */
export async function bootstrapSplitService(
  options: IBootstrapSplitServiceOptions,
): Promise<
  | { mode: "api"; app: NestFastifyApplication }
  | { mode: "worker"; app: INestApplicationContext }
> {
  const mode = serviceMode();
  const resolvedServiceName = `${options.baseServiceName}-${mode}`;
  const logger = new PinoLoggerService(resolvedServiceName);
  logger.log(`Bootstrapping ${resolvedServiceName} (SERVICE_MODE=${mode})`);

  if (isWorkerMode()) {
    const bootstrapped = await bootstrapWorkerApp({
      serviceName: resolvedServiceName,
      module: options.module,
      healthPort: options.port,
    });
    registerWorkerShutdownHandler(bootstrapped);
    return { mode: "worker", app: bootstrapped.app };
  }

  const app = await bootstrapFastifyApp({
    serviceName: resolvedServiceName,
    module: options.module,
    port: options.port,
    withValidationPipe: options.apiOptions?.withValidationPipe,
    fastifyAdapterOptions: options.apiOptions?.fastifyAdapterOptions,
    nestApplicationOptions: options.apiOptions?.nestApplicationOptions,
  });
  registerTelemetrySigtermHandler();
  return { mode: "api", app };
}
