import { Module } from "@nestjs/common";
import { TenantRolesModule } from "../tenant-roles/tenant-roles.module";
import { TenantUsersController } from "./tenant-users.controller";
import { TenantUsersRepository } from "./tenant-users.repository";
import { TenantUsersService } from "./tenant-users.service";

@Module({
  imports: [TenantRolesModule],
  controllers: [TenantUsersController],
  providers: [TenantUsersRepository, TenantUsersService],
  exports: [TenantUsersService],
})
export class TenantUsersModule {}
