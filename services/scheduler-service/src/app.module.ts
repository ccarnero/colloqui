import { Global, Module } from '@nestjs/common';
import { KubernetesModule } from './providers/kubernetes.provider';
import { TenantConnectionManager } from './providers/tenant-connection-manager';
import { SchedulesModule } from './modules/schedules/schedules.module';
import { ExecutionsModule } from './modules/executions/executions.module';
import { EngineModule } from './engine/engine.module';
import { ExecutorsModule } from './executors/executors.module';
import { HealthModule } from './modules/health/health.module';

@Global()
@Module({
  imports: [
    KubernetesModule,
    EngineModule,
    ExecutorsModule,
    SchedulesModule,
    ExecutionsModule,
    HealthModule,
  ],
  providers: [TenantConnectionManager],
  exports: [TenantConnectionManager],
})
export class AppModule {}
