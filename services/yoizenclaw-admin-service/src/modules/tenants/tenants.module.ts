import { Global, Module } from "@nestjs/common";
import { TenantProvisioningService } from "./tenant-provisioning.service";
import { TenantStreamManager } from "../../providers/tenant-stream-manager";
import { NatsAclManager } from "../../providers/nats-acl-manager";

@Global()
@Module({
  providers: [TenantProvisioningService, TenantStreamManager, NatsAclManager],
  exports: [TenantProvisioningService, TenantStreamManager, NatsAclManager],
})
export class TenantsModule {}
