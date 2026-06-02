import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { authServiceConfig } from "../../config";
import { ClientsController } from "./clients.controller";
import { ClientsMongoRepository } from "./clients.mongo.repository";
import { ClientsPostgresRepository } from "./clients.postgres.repository";
import {
  CLIENTS_REPOSITORY,
  type IClientsRepository,
} from "./clients.repository.interface";
import { ClientsService } from "./clients.service";

@Module({
  controllers: [ClientsController],
  providers: [
    createRepositoryProvider<IClientsRepository>({
      token: CLIENTS_REPOSITORY,
      engine: authServiceConfig.dbEngine,
      postgresClass: ClientsPostgresRepository,
      mongoClass: ClientsMongoRepository,
    }),
    ClientsService,
  ],
  exports: [ClientsService],
})
export class ClientsModule {}
