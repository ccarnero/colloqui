import { Module } from '@nestjs/common';
import { ObservabilityModule } from '@yoizen/observability';
import { KubernetesModule } from './providers/kubernetes.provider';
import { PostgresModule } from './providers/postgres.provider';
import { PlatformPostgresModule } from './providers/platform-postgres.provider';
import { TenantsModule } from './modules/tenants/tenants.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: 'tenant-service' }),
    KubernetesModule,
    PostgresModule,
    PlatformPostgresModule,
    TenantsModule,
    HealthModule,
  ],
})
export class AppModule {}
