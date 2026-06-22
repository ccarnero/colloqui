import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Req,
  Query,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { WorkflowProxyService } from "./workflow-proxy.service";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import { ExecuteWorkflowGatewayDto } from "./workflows-gateway.dto";

@Controller("workflows")
export class WorkflowsController {
  constructor(private readonly proxy: WorkflowProxyService) {}

  /**
   * Proxied as-is — workflow-service validates the full payload
   * (actions/trigger contain opaque nested objects that
   * class-transformer's enableImplicitConversion corrupts).
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createWorkflow(@Req() req: ITenantScopedRequest) {
    return this.proxy.proxy({
      method: "POST",
      path: "/workflows",
      tenantId: req.tenantId,
      body: req.body as Record<string, unknown>,
    });
  }

  /** @see {@link createWorkflow} — same raw-body rationale. */
  @Put(":id")
  async updateWorkflow(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy({
      method: "PUT",
      path: `/workflows/${encodeURIComponent(id)}`,
      tenantId: req.tenantId,
      body: req.body as Record<string, unknown>,
    });
  }

  @Get()
  async listWorkflows(@Req() req: ITenantScopedRequest) {
    return this.proxy.proxy({
      method: "GET",
      path: "/workflows",
      tenantId: req.tenantId,
    });
  }

  /**
   * Tenant-wide executions count grouped by definition. Declared
   * before `@Get(":id")` so Nest does not match `executions/counts`
   * as a workflow id.
   */
  @Get("executions/counts")
  async getExecutionCounts(@Req() req: ITenantScopedRequest) {
    return this.proxy.proxy({
      method: "GET",
      path: "/workflows/executions/counts",
      tenantId: req.tenantId,
    });
  }

  /**
   * Tenant-wide executions for one correlation_id (Message trace lookup).
   * Declared before `@Get(":id")` so Nest does not match `executions` as an id.
   */
  @Get("executions")
  async listExecutionsByCorrelation(
    @Req() req: ITenantScopedRequest,
    @Query() query: Record<string, string>,
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: "/workflows/executions",
      tenantId: req.tenantId,
      query,
    });
  }

  @Get(":id")
  async getWorkflow(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: `/workflows/${encodeURIComponent(id)}`,
      tenantId: req.tenantId,
    });
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteWorkflow(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy({
      method: "DELETE",
      path: `/workflows/${encodeURIComponent(id)}`,
      tenantId: req.tenantId,
    });
  }

  @Post(":id/execute")
  @HttpCode(HttpStatus.ACCEPTED)
  async executeWorkflow(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
    @Body() body: ExecuteWorkflowGatewayDto,
  ) {
    return this.proxy.proxy({
      method: "POST",
      path: `/workflows/${encodeURIComponent(id)}/execute`,
      tenantId: req.tenantId,
      body: body as unknown as Record<string, unknown>,
      requestId: req.id,
    });
  }

  @Get(":id/executions")
  async listExecutions(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
    @Query() query: Record<string, string>,
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: `/workflows/${encodeURIComponent(id)}/executions`,
      tenantId: req.tenantId,
      query,
    });
  }

  @Get(":id/executions/:executionId")
  async getExecutionStatus(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
    @Param("executionId") executionId: string,
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: `/workflows/${encodeURIComponent(id)}/executions/${encodeURIComponent(executionId)}`,
      tenantId: req.tenantId,
    });
  }
}
