import './instrumentation';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { PinoLoggerService, registerHttpMetricsHooks, shutdownTelemetry } from '@yoizen/observability';
import { AppModule } from './app.module';

async function bootstrap() {
  const pinoLogger = new PinoLoggerService('cache-service');
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: pinoLogger },
  );

  const fastify = app.getHttpAdapter().getInstance();
  registerHttpMetricsHooks(fastify, 'cache-service');

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port, '0.0.0.0');
}

bootstrap();

process.on('SIGTERM', async () => {
  await shutdownTelemetry();
  process.exit(0);
});
