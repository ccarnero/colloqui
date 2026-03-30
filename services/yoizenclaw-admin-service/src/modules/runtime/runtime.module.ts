import { Module } from '@nestjs/common';
import { RuntimeController } from './runtime.controller';
import { RuntimeService } from './runtime.service';

/**
 * Módulo de Runtime para consultar estado de conexiones
 * y métricas del sistema.
 */
@Module({
  controllers: [RuntimeController],
  providers: [RuntimeService],
  exports: [RuntimeService],
})
export class RuntimeModule {}
