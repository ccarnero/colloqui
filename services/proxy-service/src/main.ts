import './instrumentation';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import {
  PinoLoggerService,
  registerHttpMetricsHooks,
  shutdownTelemetry,
} from '@yoizen/observability';
import { AppModule } from './app.module';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function bootstrap(): Promise<void> {
  const pinoLogger = new PinoLoggerService('proxy-service');
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: pinoLogger },
  );

  const fastify = app.getHttpAdapter().getInstance();
  registerHttpMetricsHooks(fastify, 'proxy-service');

  await app.listen(PORT, '0.0.0.0');
}

bootstrap().catch((err) => {
  const logger = new PinoLoggerService("proxy-service");
  logger.error(
    "Bootstrap failed",
    err instanceof Error ? err.stack : String(err),
  );
  process.exit(1);
});

process.on('SIGTERM', async () => {
  await shutdownTelemetry();
  process.exit(0);
});
