import './instrumentation';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import {
  PinoLoggerService,
  registerHttpMetricsHooks,
  shutdownTelemetry,
} from '@yoizen/observability';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const pinoLogger = new PinoLoggerService('yoizenclaw-admin-service');
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: pinoLogger },
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const fastify = app.getHttpAdapter().getInstance();
  registerHttpMetricsHooks(fastify, 'yoizenclaw-admin-service');

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
}

bootstrap();

process.on('SIGTERM', async () => {
  await shutdownTelemetry();
  process.exit(0);
});
