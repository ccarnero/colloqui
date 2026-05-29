import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { authServiceConfig } from "../../config";
import { PublicRoutesController } from "./public-routes.controller";
import { PublicRoutesMongoRepository } from "./public-routes.mongo.repository";
import { PublicRoutesPostgresRepository } from "./public-routes.postgres.repository";
import {
  PUBLIC_ROUTES_REPOSITORY,
  type IPublicRoutesRepository,
} from "./public-routes.repository.interface";
import { PublicRoutesService } from "./public-routes.service";

@Module({
  controllers: [PublicRoutesController],
  providers: [
    createRepositoryProvider<IPublicRoutesRepository>({
      token: PUBLIC_ROUTES_REPOSITORY,
      engine: authServiceConfig.dbEngine,
      postgresClass: PublicRoutesPostgresRepository,
      mongoClass: PublicRoutesMongoRepository,
    }),
    PublicRoutesService,
  ],
  exports: [PublicRoutesService],
})
export class PublicRoutesModule {}
