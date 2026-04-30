import { Module } from "@nestjs/common";
import { WorkflowsController } from "./workflows.controller";
import { WorkflowProxyService } from "./workflow-proxy.service";

@Module({
  controllers: [WorkflowsController],
  providers: [WorkflowProxyService],
})
export class WorkflowsModule {}
