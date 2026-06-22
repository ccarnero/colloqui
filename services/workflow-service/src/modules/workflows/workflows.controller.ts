import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { TenantGuard, TenantId } from "@yoizen/database";
import type { FastifyRequest } from "fastify";
import { CreateWorkflowDto } from "./dto/create-workflow.dto";
import { parseListExecutionsQuery } from "./dto/list-executions-query.dto";
import { UpdateWorkflowDto } from "./dto/update-workflow.dto";
import { WorkflowsService } from "./workflows.service";

@Controller("workflows")
@UseGuards(TenantGuard)
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createWorkflow(
    @TenantId() tenantId: string,
    @Body() dto: CreateWorkflowDto
  ) {
    return this.workflowsService.createWorkflow({
      tenantId,
      name: dto.name,
      application: dto.application,
      actions: dto.actions,
      trigger: dto.trigger,
      variables: dto.variables,
    });
  }

  @Put(":id")
  async updateWorkflow(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateWorkflowDto
  ) {
    return this.workflowsService.updateWorkflow({
      id,
      tenantId,
      name: dto.name,
      application: dto.application,
      actions: dto.actions,
      trigger: dto.trigger,
      variables: dto.variables,
    });
  }

  @Get()
  async listWorkflows(@TenantId() tenantId: string) {
    return this.workflowsService.listWorkflows(tenantId);
  }

  /**
   * Tenant-wide summary: active definitions, failing definitions,
   * execution counts by status for 24h/7d windows, and top definitions
   * by execution count. Declared before `@Get(":id")` so Nest does not
   * match `summary` as a workflow id.
   */
  @Get("summary")
  async getSummary(@TenantId() tenantId: string) {
    return this.workflowsService.getWorkflowsSummary(tenantId);
  }

  /**
   * Tenant-wide executions count grouped by definition. Declared
   * before `@Get(":id")` so Nest does not match `executions/counts`
   * as a workflow id.
   */
  @Get("executions/counts")
  async getExecutionCounts(@TenantId() tenantId: string) {
    return this.workflowsService.getExecutionCountsByTenant(tenantId);
  }

  /**
   * Tenant-wide executions for one correlation_id (Message trace lookup).
   * Declared before `@Get(":id")` so Nest does not match `executions` as an id.
   */
  @Get("executions")
  async listExecutionsByCorrelation(
    @TenantId() tenantId: string,
    @Query("correlation_id") correlationId: string
  ) {
    return this.workflowsService.findExecutionsByCorrelation(
      tenantId,
      correlationId ?? ""
    );
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
    @Body() rawBody: Record<string, unknown>,
    @Req() req: FastifyRequest
  ) {
    const requestId =
      (req.headers["x-request-id"] as string | undefined) ?? null;
    const request = (rawBody.request ?? {}) as Record<string, unknown>;
    const agentTimeoutSec =
      typeof rawBody.agentTimeoutSec === "number"
        ? rawBody.agentTimeoutSec
        : undefined;
    return this.workflowsService.executeWorkflow(id, tenantId, request, {
      requestId,
      agentTimeoutMs: agentTimeoutSec ? agentTimeoutSec * 1000 : undefined,
    });
  }

  @Get(":id/executions")
  async listExecutions(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Query() query: Record<string, unknown>
  ) {
    const parsed = parseListExecutionsQuery(query);
    return this.workflowsService.listExecutions(id, tenantId, parsed);
  }

  @Get(":id/executions/:executionId")
  async getExecutionStatus(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Param("executionId") executionId: string
  ) {
    return this.workflowsService.getExecutionStatus(id, executionId, tenantId);
  }
}
