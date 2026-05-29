import { Module } from "@nestjs/common";
import { KubernetesModule } from "../../providers/kubernetes.provider";
import { TenantDatabaseModule } from "../../providers/tenant-database.module";
import { TenantNatsModule } from "../../providers/nats.module";
import { YoizenClawRuntimeModule } from "../../providers/yoizenclaw-runtime.provider";
import { TenantsModule } from "../tenants/tenants.module";
import { TenantProvisionConsumerService } from "./tenant-provision-consumer.service";
import { TenantProvisionHandler } from "./tenant-provision-handler.service";
import { TenantProvisioningExecutor } from "./tenant-provisioning-executor.service";

@Module({
  imports: [
    TenantNatsModule,
    KubernetesModule,
    TenantDatabaseModule,
    YoizenClawRuntimeModule,
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
