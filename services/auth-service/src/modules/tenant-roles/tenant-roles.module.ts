import { Module } from "@nestjs/common";
import { TenantRolesController } from "./tenant-roles.controller";
import { TenantRolesRepository } from "./tenant-roles.repository";
import { TenantRolesService } from "./tenant-roles.service";

@Module({
  controllers: [TenantRolesController],
  providers: [TenantRolesRepository, TenantRolesService],
  exports: [TenantRolesService],
})
export class TenantRolesModule {}
