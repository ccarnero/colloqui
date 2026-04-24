import { Module } from "@nestjs/common";
import { TenantNatsModule } from "../../providers/nats.module";
import { TenantProvisionPublisher } from "../../providers/tenant-provision-publisher.service";
import { TenantsController } from "./tenants.controller";
import { TenantsService } from "./tenants.service";
import { TenantsRepository } from "./tenants.repository";

@Module({
  imports: [TenantNatsModule],
  controllers: [TenantsController],
  providers: [TenantsService, TenantsRepository, TenantProvisionPublisher],
  exports: [TenantsService, TenantsRepository],
})
export class TenantsModule {}
