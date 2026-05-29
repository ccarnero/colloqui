import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { tenantServiceConfig } from "../../config";
import { TenantNatsModule } from "../../providers/nats.module";
import { TenantProvisionPublisher } from "../../providers/tenant-provision-publisher.service";
import { TenantDeletionPublisher } from "../../providers/tenant-deletion-publisher.service";
import { TenantReadyPublisher } from "../../providers/tenant-ready-publisher.service";
import { TenantsController } from "./tenants.controller";
import { TenantsService } from "./tenants.service";
import { TenantsMongoRepository } from "./tenants.mongo.repository";
import { TenantsPostgresRepository } from "./tenants.postgres.repository";
import {
  TENANTS_REPOSITORY,
  type ITenantsRepository,
} from "./tenants.repository.interface";

@Module({
  imports: [TenantNatsModule],
  controllers: [TenantsController],
  providers: [
    createRepositoryProvider<ITenantsRepository>({
      token: TENANTS_REPOSITORY,
      engine: tenantServiceConfig.dbEngine,
      postgresClass: TenantsPostgresRepository,
      mongoClass: TenantsMongoRepository,
    }),
    TenantsService,
    TenantProvisionPublisher,
    TenantDeletionPublisher,
    TenantReadyPublisher,
  ],
  exports: [TenantsService, TENANTS_REPOSITORY, TenantReadyPublisher],
})
export class TenantsModule {}
