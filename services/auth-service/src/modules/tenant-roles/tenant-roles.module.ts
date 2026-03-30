import { Module } from "@nestjs/common";
import { TenantRolesController } from "./tenant-roles.controller";
import { TenantRolesService } from "./tenant-roles.service";

@Module({
  controllers: [TenantRolesController],
  providers: [TenantRolesService],
  exports: [TenantRolesService],
})
export class TenantRolesModule {}
