import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventsModule } from './modules/events/events.module';
import { AuditModule } from './modules/audit/audit.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { SchedulersModule } from './modules/schedulers/schedulers.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProvidersModule } from './providers/providers.module';
import { TenantGuard } from './guards/tenant.guard';
import { AuthGuard } from './guards/auth.guard';

@Module({
  imports: [
    ProvidersModule,
    AuthModule,
    EventsModule,
    AuditModule,
    TenantsModule,
    SchedulersModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: TenantGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
