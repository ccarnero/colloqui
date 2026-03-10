import { Module } from '@nestjs/common';
import { KubernetesModule } from './providers/kubernetes.provider';
import { PostgresModule } from './providers/postgres.provider';
import { ServicesModule } from './modules/services/services.module';
import { CanaryModule } from './modules/canary/canary.module';
import { RoutesModule } from './modules/routes/routes.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    KubernetesModule,
    PostgresModule,
    ServicesModule,
    CanaryModule,
    RoutesModule,
    HealthModule,
  ],
})
export class AppModule {}
