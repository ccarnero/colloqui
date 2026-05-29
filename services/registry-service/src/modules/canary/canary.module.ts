import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { registryServiceConfig } from "../../config";
import { CanaryController } from "./canary.controller";
import { CanaryMongoRepository } from "./canary.mongo.repository";
import { CanaryPostgresRepository } from "./canary.postgres.repository";
import {
  CANARY_REPOSITORY,
  type ICanaryRepository,
} from "./canary.repository.interface";
import { CanaryService } from "./canary.service";

@Module({
  controllers: [CanaryController],
  providers: [
    createRepositoryProvider<ICanaryRepository>({
      token: CANARY_REPOSITORY,
      engine: registryServiceConfig.dbEngine,
      postgresClass: CanaryPostgresRepository,
      mongoClass: CanaryMongoRepository,
    }),
    CanaryService,
  ],
})
export class CanaryModule {}
