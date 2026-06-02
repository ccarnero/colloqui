import { Module } from "@nestjs/common";
import { ObservabilityModule } from "@yoizen/observability";
import { KubernetesModule } from "./providers/kubernetes.provider";
import { TenantDatabaseModule } from "./providers/tenant-database.module";
import { TenantNatsModule } from "./providers/nats.module";
import { TenantsModule } from "./modules/tenants/tenants.module";
import { TenantProvisionModule } from "./modules/provisioning/tenant-provision.module";
import { HealthModule } from "./modules/health/health.module";

@Module({
  imports: [
    ObservabilityModule.forRoot({ serviceName: "tenant-service" }),
    TenantNatsModule,
    KubernetesModule,
    TenantDatabaseModule,
    TenantsModule,
    TenantProvisionModule,
    HealthModule,
  ],
})
export class AppModule {}
