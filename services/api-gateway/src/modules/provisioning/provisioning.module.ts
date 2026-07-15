import { Module } from "@nestjs/common";
import { ProvisioningController } from "./provisioning.controller";
import { ProvisioningProxyService } from "./provisioning-proxy.service";

@Module({
  controllers: [ProvisioningController],
  providers: [ProvisioningProxyService],
})
export class ProvisioningModule {}
