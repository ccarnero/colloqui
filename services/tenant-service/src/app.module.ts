import { Module } from '@nestjs/common';
import { KubernetesModule } from './providers/kubernetes.provider';
import { PostgresModule } from './providers/postgres.provider';
import { TenantsModule } from './modules/tenants/tenants.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [KubernetesModule, PostgresModule, TenantsModule, HealthModule],
})
export class AppModule {}
