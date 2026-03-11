import { Module } from '@nestjs/common';
import { KubernetesModule } from './providers/kubernetes.provider';
import { PostgresModule } from './providers/postgres.provider';
import { PlatformPostgresModule } from './providers/platform-postgres.provider';
import { TenantsModule } from './modules/tenants/tenants.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    KubernetesModule,
    PostgresModule,
    PlatformPostgresModule,
    TenantsModule,
    HealthModule,
  ],
})
export class AppModule {}
