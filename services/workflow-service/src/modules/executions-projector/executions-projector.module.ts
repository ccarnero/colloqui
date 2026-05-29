import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { workflowServiceConfig } from "../../config";
import { ExecutionProjectorService } from "./execution-projector.service";
import { ExecutionsProjectionMongoRepository } from "./executions.mongo.repository";
import { ExecutionsProjectionPostgresRepository } from "./executions.postgres.repository";
import {
  EXECUTIONS_PROJECTION_REPOSITORY,
  type IExecutionsProjectionRepository,
} from "./executions.repository.interface";

@Module({
  providers: [
    createRepositoryProvider<IExecutionsProjectionRepository>({
      token: EXECUTIONS_PROJECTION_REPOSITORY,
      engine: workflowServiceConfig.dbEngine,
      postgresClass: ExecutionsProjectionPostgresRepository,
      mongoClass: ExecutionsProjectionMongoRepository,
    }),
    ExecutionProjectorService,
  ],
})
export class ExecutionsProjectorModule {}
