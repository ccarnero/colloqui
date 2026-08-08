import { ValidationPipe, type NestApplicationOptions } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { PinoLoggerService } from "./logger";
import { registerHttpMetricsHooks } from "./http-metrics";
import { shutdownTelemetry } from "./telemetry";
import { PRODUCTION_VALIDATION_PIPE_OPTIONS } from "./validation-pipe-options";

export interface IBootstrapFastifyOptions {
  serviceName: string;
  module: unknown;
  port: number;
  withValidationPipe?: boolean;
  /**
   * Options passed to `new FastifyAdapter(...)`.
   * E.g. `{ bodyLimit: 1_048_576 }` for channel-service.
   */
  fastifyAdapterOptions?: ConstructorParameters<typeof FastifyAdapter>[0];
  /**
   * Extra Nest `NestFactory.create` options merged with `{ logger }`.
   * Use `{ rawBody: true }` when controllers need `RawBodyRequest` (e.g. webhook HMAC).
   */
  nestApplicationOptions?: NestApplicationOptions;
}

/**
 * Shared bootstrap for Nest + Fastify services: logger, optional ValidationPipe,
 * HTTP metrics hooks, listen on 0.0.0.0.
 */
export async function bootstrapFastifyApp(
  options: IBootstrapFastifyOptions,
): Promise<NestFastifyApplication> {
  const logger = new PinoLoggerService(options.serviceName);
  const app = await NestFactory.create<NestFastifyApplication>(
    options.module as Parameters<typeof NestFactory.create>[0],
    new FastifyAdapter(options.fastifyAdapterOptions ?? {}),
    {
      logger,
      ...options.nestApplicationOptions,
    },
  );

  if (options.withValidationPipe) {
    // A FRESH pipe instance per boot, built from the single shared options
    // object: the OPTIONS are shared platform-wide, the pipe INSTANCE never is.
    logger.log(
      `Registering global ValidationPipe from PRODUCTION_VALIDATION_PIPE_OPTIONS: ${JSON.stringify(
        PRODUCTION_VALIDATION_PIPE_OPTIONS,
      )}`,
    );
    app.useGlobalPipes(new ValidationPipe(PRODUCTION_VALIDATION_PIPE_OPTIONS));
  }

  const fastify = app.getHttpAdapter().getInstance();
  registerHttpMetricsHooks(fastify, options.serviceName);
  await app.listen(options.port, "0.0.0.0");
  return app;
}

/**
 * Registers `SIGTERM` -> `shutdownTelemetry()` then `process.exit(0)`.
 * Call once from each service `main.ts` after bootstrap.
 */
export function registerTelemetrySigtermHandler(): void {
  process.on("SIGTERM", async () => {
    await shutdownTelemetry();
    process.exit(0);
  });
}

/**
 * Runs bootstrap with standard failure logging, exit code 1 on failure, and
 * {@link registerTelemetrySigtermHandler}. Import `./instrumentation` first in `main.ts`.
 */
export function runNestFastifyServiceMain(
  serviceName: string,
  bootstrap: () => Promise<void>,
): void {
  void bootstrap().catch((err: unknown) => {
    const logger = new PinoLoggerService(serviceName);
    const detail =
      err instanceof Error
        ? `${err.name}: ${err.message}`
        : typeof err === "string"
          ? err
          : JSON.stringify(err);
    const stack = err instanceof Error ? err.stack : undefined;
    logger.error(
      `Bootstrap failed — ${detail}`,
      stack ?? detail,
    );
    process.exit(1);
  });
  registerTelemetrySigtermHandler();
}
