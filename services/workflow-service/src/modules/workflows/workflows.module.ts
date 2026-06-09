import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { workflowServiceConfig } from "../../config";
import { ExecutionsMongoRepository } from "./executions.mongo.repository";
import { ExecutionsPostgresRepository } from "./executions.postgres.repository";
import {
  EXECUTIONS_REPOSITORY,
  type IExecutionsRepository,
} from "./executions.repository.interface";
import { RegisteredServicesResolver } from "./registered-services.resolver";
import { SystemVariablesProvider } from "./system-variables.provider";
import { WorkflowsController } from "./workflows.controller";
import { WorkflowsMongoRepository } from "./workflows.mongo.repository";
import { WorkflowsPostgresRepository } from "./workflows.postgres.repository";
import {
  WORKFLOWS_REPOSITORY,
  type IWorkflowsRepository,
} from "./workflows.repository.interface";
import { WorkflowsService } from "./workflows.service";

@Module({
  controllers: [WorkflowsController],
  providers: [
    createRepositoryProvider<IWorkflowsRepository>({
      token: WORKFLOWS_REPOSITORY,
      engine: workflowServiceConfig.dbEngine,
      postgresClass: WorkflowsPostgresRepository,
      mongoClass: WorkflowsMongoRepository,
    }),
    createRepositoryProvider<IExecutionsRepository>({
      token: EXECUTIONS_REPOSITORY,
      engine: workflowServiceConfig.dbEngine,
      postgresClass: ExecutionsPostgresRepository,
      mongoClass: ExecutionsMongoRepository,
    }),
    WorkflowsService,
    RegisteredServicesResolver,
    SystemVariablesProvider,
  ],
  exports: [
    WorkflowsService,
    WORKFLOWS_REPOSITORY,
    EXECUTIONS_REPOSITORY,
    RegisteredServicesResolver,
  ],
})
export class WorkflowsModule {}
