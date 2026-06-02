import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { registryServiceConfig } from "../../config";
import { RoutesController } from "./routes.controller";
import { RoutesMongoRepository } from "./routes.mongo.repository";
import { RoutesPostgresRepository } from "./routes.postgres.repository";
import {
  ROUTES_REPOSITORY,
  type IRoutesRepository,
} from "./routes.repository.interface";
import { RoutesService } from "./routes.service";

@Module({
  controllers: [RoutesController],
  providers: [
    createRepositoryProvider<IRoutesRepository>({
      token: ROUTES_REPOSITORY,
      engine: registryServiceConfig.dbEngine,
      postgresClass: RoutesPostgresRepository,
      mongoClass: RoutesMongoRepository,
    }),
    RoutesService,
  ],
})
export class RoutesModule {}
