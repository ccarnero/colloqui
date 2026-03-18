import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ObservabilityModule } from '@yoizen/observability';
import { EventsModule } from './modules/events/events.module';
import { AuditModule } from './modules/audit/audit.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { SchedulersModule } from './modules/schedulers/schedulers.module';
import { RegistryModule } from './modules/registry/registry.module';
import { DynamicRoutesModule } from './modules/dynamic-routes/dynamic-routes.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { ProxyModule } from './modules/proxy/proxy.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { RateLimitModule } from './modules/rate-limit/rate-limit.module';
import { ProvidersModule } from './providers/providers.module';
import { TenantGuard } from './guards/tenant.guard';
import { AuthGuard } from './guards/auth.guard';
import { AuditInterceptor } from './interceptors/audit.interceptor';

@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: 'api-gateway' }),
    ProvidersModule,
    AuthModule,
    EventsModule,
    AuditModule,
    TenantsModule,
    SchedulersModule,
    RegistryModule,
    WorkflowsModule,
    ProxyModule,
    DynamicRoutesModule,
    RateLimitModule,
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
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
