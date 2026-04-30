import { Module } from "@nestjs/common";
import { KubernetesModule } from "../../providers/kubernetes.provider";
import { PostgresModule } from "../../providers/postgres.provider";
import { UsagePostgresModule } from "../../providers/postgres-usage.provider";
import { TenantNatsModule } from "../../providers/nats.module";
import { TenantsModule } from "../tenants/tenants.module";
import { TenantProvisionConsumerService } from "./tenant-provision-consumer.service";
import { TenantProvisionHandler } from "./tenant-provision-handler.service";
import { TenantProvisioningExecutor } from "./tenant-provisioning-executor.service";

@Module({
  imports: [
    TenantNatsModule,
    KubernetesModule,
    PostgresModule,
    UsagePostgresModule,
    TenantsModule,
  ],
  providers: [
    TenantProvisioningExecutor,
    TenantProvisionHandler,
    TenantProvisionConsumerService,
  ],
  exports: [TenantProvisionConsumerService],
})
export class TenantProvisionModule {}
