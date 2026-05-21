import { Module } from "@nestjs/common";
import { WorkflowsController } from "./workflows.controller";
import { WorkflowsService } from "./workflows.service";
import { WorkflowsRepository } from "./workflows.repository";
import { RegisteredServicesResolver } from "./registered-services.resolver";

@Module({
  controllers: [WorkflowsController],
  providers: [WorkflowsService, WorkflowsRepository, RegisteredServicesResolver],
  exports: [WorkflowsService, WorkflowsRepository, RegisteredServicesResolver],
})
export class WorkflowsModule {}
