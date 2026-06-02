import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { authServiceConfig } from "../../config";
import { TenantRolesModule } from "../tenant-roles/tenant-roles.module";
import { TenantUsersController } from "./tenant-users.controller";
import { TenantUsersMongoRepository } from "./tenant-users.mongo.repository";
import { TenantUsersPostgresRepository } from "./tenant-users.postgres.repository";
import {
  TENANT_USERS_REPOSITORY,
  type ITenantUsersRepository,
} from "./tenant-users.repository.interface";
import { TenantUsersService } from "./tenant-users.service";

@Module({
  imports: [TenantRolesModule],
  controllers: [TenantUsersController],
  providers: [
    createRepositoryProvider<ITenantUsersRepository>({
      token: TENANT_USERS_REPOSITORY,
      engine: authServiceConfig.dbEngine,
      postgresClass: TenantUsersPostgresRepository,
      mongoClass: TenantUsersMongoRepository,
    }),
    TenantUsersService,
  ],
  exports: [TenantUsersService],
})
export class TenantUsersModule {}
