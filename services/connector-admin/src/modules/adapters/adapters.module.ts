import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { connectorAdminConfig } from "../../config";
import {
  ADAPTER_USAGE_REPOSITORY,
  AdapterUsagePostgresRepository,
} from "./adapter-usage.postgres.repository";
import { AdaptersController } from "./adapters.controller";
import { AdaptersMongoRepository } from "./adapters.mongo.repository";
import { AdaptersPostgresRepository } from "./adapters.postgres.repository";
import {
  ADAPTERS_REPOSITORY,
  type IAdaptersRepository,
} from "./adapters.repository.interface";
import { AdaptersService } from "./adapters.service";

@Module({
  controllers: [AdaptersController],
  providers: [
    createRepositoryProvider<IAdaptersRepository>({
      token: ADAPTERS_REPOSITORY,
      engine: connectorAdminConfig.dbEngine,
      postgresClass: AdaptersPostgresRepository,
      mongoClass: AdaptersMongoRepository,
    }),
    AdaptersService,
    AdapterUsagePostgresRepository,
    {
      provide: ADAPTER_USAGE_REPOSITORY,
      useExisting: AdapterUsagePostgresRepository,
    },
  ],
  exports: [ADAPTERS_REPOSITORY, AdaptersService, ADAPTER_USAGE_REPOSITORY],
})
export class AdaptersModule {}
