import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import { TenantGuard, TenantId } from "@yoizen/database";
import { CreateWorkflowDto } from "./dto/create-workflow.dto";
import { UpdateWorkflowDto } from "./dto/update-workflow.dto";
import { ExecuteWorkflowDto } from "./dto/execute-workflow.dto";
import { WorkflowsService } from "./workflows.service";

@Controller("workflows")
@UseGuards(TenantGuard)
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createWorkflow(
    @TenantId() tenantId: string,
    @Body() dto: CreateWorkflowDto,
  ) {
    return this.workflowsService.createWorkflow({
      tenantId,
      name: dto.name,
      application: dto.application,
      actions: dto.actions,
      trigger: dto.trigger,
    });
  }

  @Put(":id")
  async updateWorkflow(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateWorkflowDto,
  ) {
    return this.workflowsService.updateWorkflow({
      id,
      tenantId,
      name: dto.name,
      application: dto.application,
      actions: dto.actions,
      trigger: dto.trigger,
    });
  }

  @Get()
  async listWorkflows(@TenantId() tenantId: string) {
    return this.workflowsService.listWorkflows(tenantId);
  }

  @Get(":id")
  async getWorkflow(@TenantId() tenantId: string, @Param("id") id: string) {
    return this.workflowsService.getWorkflow(id, tenantId);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteWorkflow(@TenantId() tenantId: string, @Param("id") id: string) {
    await this.workflowsService.deleteWorkflow(id, tenantId);
  }

  @Post(":id/execute")
  @HttpCode(HttpStatus.ACCEPTED)
  async executeWorkflow(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: ExecuteWorkflowDto,
  ) {
    return this.workflowsService.executeWorkflow(id, tenantId, dto.request);
  }

  @Get(":id/executions")
  async listExecutions(@TenantId() tenantId: string, @Param("id") id: string) {
    return this.workflowsService.listExecutions(id, tenantId);
  }

  @Get(":id/executions/:executionId")
  async getExecutionStatus(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Param("executionId") executionId: string,
  ) {
    return this.workflowsService.getExecutionStatus(id, executionId, tenantId);
  }
}
