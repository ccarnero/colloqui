import { Module } from '@nestjs/common';
import { ProvidersModule } from './providers/providers.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [ProvidersModule, WorkflowsModule, HealthModule],
})
export class AppModule {}
