import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { TENANT_HEADER } from "@yoizen/shared";
import type { WorkflowAction } from "@yoizen/shared";
import { CreateWorkflowDto } from "./dto/create-workflow.dto";
import { ExecuteWorkflowDto } from "./dto/execute-workflow.dto";
import { WorkflowsService } from "./workflows.service";

@Controller("workflows")
export class WorkflowsController {
  constructor(
    private readonly workflowsService: WorkflowsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createWorkflow(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Body() dto: CreateWorkflowDto,
  ) {
    if (!tenantId) {
      throw new BadRequestException(
        `Missing required header: ${TENANT_HEADER}`,
      );
    }

    return this.workflowsService.createWorkflow(
      tenantId,
      dto.name,
      dto.application,
      dto.actions as WorkflowAction[],
    );
  }

  @Get()
  async listWorkflows(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
  ) {
    if (!tenantId) {
      throw new BadRequestException(
        `Missing required header: ${TENANT_HEADER}`,
      );
    }

    return this.workflowsService.listWorkflows(tenantId);
  }

  @Get(":id")
  async getWorkflow(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param("id") id: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException(
        `Missing required header: ${TENANT_HEADER}`,
      );
    }

    return this.workflowsService.getWorkflow(id, tenantId);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteWorkflow(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param("id") id: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException(
        `Missing required header: ${TENANT_HEADER}`,
      );
    }

    await this.workflowsService.deleteWorkflow(id, tenantId);
  }

  @Post(":id/execute")
  @HttpCode(HttpStatus.ACCEPTED)
  async executeWorkflow(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param("id") id: string,
    @Body() dto: ExecuteWorkflowDto,
  ) {
    if (!tenantId) {
      throw new BadRequestException(
        `Missing required header: ${TENANT_HEADER}`,
      );
    }

    return this.workflowsService.executeWorkflow(
      id,
      tenantId,
      dto.request,
    );
  }

  @Get(":id/executions")
  async listExecutions(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param("id") id: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException(
        `Missing required header: ${TENANT_HEADER}`,
      );
    }

    return this.workflowsService.listExecutions(id, tenantId);
  }

  @Get(":id/executions/:executionId")
  async getExecutionStatus(
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Param("id") _id: string,
    @Param("executionId") executionId: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException(
        `Missing required header: ${TENANT_HEADER}`,
      );
    }

    return this.workflowsService.getExecutionStatus(
      executionId,
      tenantId,
    );
  }
}
