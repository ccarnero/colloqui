import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * Módulo de Health para endpoints de health checking.
 *
 * Provee:
 * - GET /health - Verifica estado del servicio y dependencias
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
