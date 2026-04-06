import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ObservabilityModule } from "@yoizen/observability";
import { EventsModule } from "./modules/events/events.module";
import { AuditModule } from "./modules/audit/audit.module";
import { TenantsModule } from "./modules/tenants/tenants.module";
import { SchedulersModule } from "./modules/schedulers/schedulers.module";
import { RegistryModule } from "./modules/registry/registry.module";
import { AdaptersModule } from "./modules/adapters/adapters.module";
import { ChannelsModule } from "./modules/channels/channels.module";
import { DynamicRoutesModule } from "./modules/dynamic-routes/dynamic-routes.module";
import { WorkflowsModule } from "./modules/workflows/workflows.module";
import { ProxyModule } from "./modules/proxy/proxy.module";
import { AdminModule } from "./modules/admin/admin.module";
import { HealthModule } from "./modules/health/health.module";
import { AuthModule } from "./modules/auth/auth.module";
import { RateLimitModule } from "./modules/rate-limit/rate-limit.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { ProvidersModule } from "./providers/providers.module";
import { TenantGuard } from "./guards/tenant.guard";
import { AuthGuard } from "./guards/auth.guard";
import { AuditInterceptor } from "./interceptors/audit.interceptor";
import { ServiceExceptionFilter } from "./filters/service-exception.filter";

@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "api-gateway" }),
    ProvidersModule,
    AuthModule,
    EventsModule,
    AuditModule,
    TenantsModule,
    SchedulersModule,
    RegistryModule,
    AdaptersModule,
    ChannelsModule,
    WorkflowsModule,
    ProxyModule,
    AdminModule,
    DynamicRoutesModule,
    RateLimitModule,
    DashboardModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ServiceExceptionFilter,
    },
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
