import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ObservabilityModule } from "@yoizen/observability";
import { ServiceExceptionFilter } from "./filters/service-exception.filter";
import { AuthGuard } from "./guards/auth.guard";
import { TenantGuard } from "./guards/tenant.guard";
import { AuditInterceptor } from "./interceptors/audit.interceptor";
import { AdminModule } from "./modules/admin/admin.module";
import { AuditModule } from "./modules/audit/audit.module";
import { AuthModule } from "./modules/auth/auth.module";
import { ChannelsModule } from "./modules/channels/channels.module";
import { ConnectorInvokeModule } from "./modules/connector-invoke/connector-invoke.module";
import { ConnectorsModule } from "./modules/connectors/connectors.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { DynamicRoutesModule } from "./modules/dynamic-routes/dynamic-routes.module";
import { HealthModule } from "./modules/health/health.module";
import { ProvisioningModule } from "./modules/provisioning/provisioning.module";
import { ProxyModule } from "./modules/proxy/proxy.module";
import { RateLimitModule } from "./modules/rate-limit/rate-limit.module";
import { RegistryModule } from "./modules/registry/registry.module";
import { RuntimeModule } from "./modules/runtime/runtime.module";
import { TenantsModule } from "./modules/tenants/tenants.module";
import { TrackingModule } from "./modules/tracking/tracking.module";
import { WorkflowsModule } from "./modules/workflows/workflows.module";
import { ProvidersModule } from "./providers/providers.module";

@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "api-gateway" }),
    ProvidersModule,
    AuthModule,
    AuditModule,
    TrackingModule,
    TenantsModule,
    RegistryModule,
    ConnectorsModule,
    ConnectorInvokeModule,
    ChannelsModule,
    WorkflowsModule,
    ProvisioningModule,
    ProxyModule,
    AdminModule,
    RuntimeModule,
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
