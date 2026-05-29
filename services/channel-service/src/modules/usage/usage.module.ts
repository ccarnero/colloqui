import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { channelServiceConfig } from "../../config";
import { UsageController } from "./usage.controller";
import { UsageMongoRepository } from "./usage.mongo.repository";
import { UsagePostgresRepository } from "./usage.postgres.repository";
import {
  USAGE_REPOSITORY,
  type IUsageRepository,
} from "./usage.repository.interface";
import { UsageService } from "./usage.service";
import { UsageTenantConnectionManager } from "./tenant-connection-manager";
import { UsageTenantConnectionManagerMongo } from "./tenant-connection-manager.mongo";
import { UsageTenantConnectionManagerPostgres } from "./tenant-connection-manager.postgres";

const engine = channelServiceConfig.dbEngine;
const usageManagerClass =
  engine === "postgres"
    ? UsageTenantConnectionManagerPostgres
    : UsageTenantConnectionManagerMongo;

@Module({
  controllers: [UsageController],
  providers: [
    createRepositoryProvider<IUsageRepository>({
      token: USAGE_REPOSITORY,
      engine: channelServiceConfig.dbEngine,
      postgresClass: UsagePostgresRepository,
      mongoClass: UsageMongoRepository,
    }),
    UsageService,
    {
      provide: UsageTenantConnectionManager,
      useClass: usageManagerClass,
    },
  ],
  exports: [UsageTenantConnectionManager],
})
export class UsageModule {}
