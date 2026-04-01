import "./instrumentation";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { ValidationPipe } from "@nestjs/common";
import {
  PinoLoggerService,
  registerHttpMetricsHooks,
  shutdownTelemetry,
} from "@yoizen/observability";
import { AppModule } from "./app.module";

const SERVICE_NAME = "yoizenclaw-admin-service";
const BOOTSTRAP_CONTEXT = "Bootstrap";
const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const bootstrapLogger = new PinoLoggerService(SERVICE_NAME);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: bootstrapLogger },
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const fastify = app.getHttpAdapter().getInstance();
  registerHttpMetricsHooks(fastify, SERVICE_NAME);

  await app.listen(PORT, "0.0.0.0");
  bootstrapLogger.log(
    `HTTP server listening on 0.0.0.0:${PORT}`,
    BOOTSTRAP_CONTEXT,
  );
}

bootstrap().catch((error: unknown) => {
  if (error instanceof Error) {
    bootstrapLogger.error(error.message, error.stack, BOOTSTRAP_CONTEXT);
  } else {
    bootstrapLogger.error(
      "Application bootstrap failed with a non-Error rejection",
      BOOTSTRAP_CONTEXT,
    );
  }

  void shutdownTelemetry()
    .catch(() => undefined)
    .finally(() => {
      process.exit(1);
    });
});

process.on("SIGTERM", async () => {
  await shutdownTelemetry();
  process.exit(0);
});
