import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { authServiceConfig } from "../../config";
import { TenantRolesController } from "./tenant-roles.controller";
import { TenantRolesMongoRepository } from "./tenant-roles.mongo.repository";
import { TenantRolesPostgresRepository } from "./tenant-roles.postgres.repository";
import {
  TENANT_ROLES_REPOSITORY,
  type ITenantRolesRepository,
} from "./tenant-roles.repository.interface";
import { TenantRolesService } from "./tenant-roles.service";

@Module({
  controllers: [TenantRolesController],
  providers: [
    createRepositoryProvider<ITenantRolesRepository>({
      token: TENANT_ROLES_REPOSITORY,
      engine: authServiceConfig.dbEngine,
      postgresClass: TenantRolesPostgresRepository,
      mongoClass: TenantRolesMongoRepository,
    }),
    TenantRolesService,
  ],
  exports: [TenantRolesService],
})
export class TenantRolesModule {}
