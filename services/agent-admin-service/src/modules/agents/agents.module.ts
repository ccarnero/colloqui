import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { agentAdminServiceConfig } from "../../config";
import { AdaptersModule } from "../adapters/adapters.module";
import { AgentsController } from "./agents.controller";
import { AgentsMongoRepository } from "./agents.mongo.repository";
import { AgentsPostgresRepository } from "./agents.postgres.repository";
import {
  AGENTS_REPOSITORY,
  type IAgentsRepository,
} from "./agents.repository.interface";
import { AgentsRuntimeService } from "./agents-runtime.service";
import { AgentsService } from "./agents.service";

@Module({
  imports: [AdaptersModule],
  controllers: [AgentsController],
  providers: [
    createRepositoryProvider<IAgentsRepository>({
      token: AGENTS_REPOSITORY,
      engine: agentAdminServiceConfig.dbEngine,
      postgresClass: AgentsPostgresRepository,
      mongoClass: AgentsMongoRepository,
    }),
    AgentsService,
    AgentsRuntimeService,
  ],
  exports: [AgentsService, AgentsRuntimeService],
})
export class AgentsModule {}
