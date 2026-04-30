import { Module } from "@nestjs/common";
import { ObservabilityModule } from "@yoizen/observability";
import { KubernetesModule } from "./providers/kubernetes.provider";
import { PostgresModule } from "./providers/postgres.provider";
import { UsagePostgresModule } from "./providers/postgres-usage.provider";
import { PlatformPostgresModule } from "./providers/platform-postgres.provider";
import { TenantNatsModule } from "./providers/nats.module";
import { TenantsModule } from "./modules/tenants/tenants.module";
import { TenantProvisionModule } from "./modules/provisioning/tenant-provision.module";
import { HealthModule } from "./modules/health/health.module";

@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "tenant-service" }),
    TenantNatsModule,
    KubernetesModule,
    PostgresModule,
    UsagePostgresModule,
    PlatformPostgresModule,
    TenantsModule,
    TenantProvisionModule,
    HealthModule,
  ],
})
export class AppModule {}
