import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
// biome-ignore lint/style/useImportType: constructor-injected — Nest DI needs the runtime class reference.
import { WorkflowProxyService } from "./workflow-proxy.service";
// biome-ignore lint/style/useImportType: used as @Body() metatype — needed at runtime for ValidationPipe's class-validator/class-transformer reflection.
import {
  ExecuteWorkflowGatewayDto,
  UpdateWorkflowStatusGatewayDto,
} from "./workflows-gateway.dto";

@ApiTags("workflows")
@Controller("workflows")
export class WorkflowsController {
  constructor(private readonly proxy: WorkflowProxyService) {}

  @Patch(":id/status")
  async updateWorkflowStatus(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
    @Body() body: UpdateWorkflowStatusGatewayDto
  ) {
    return this.proxy.proxy({
      method: "PATCH",
      path: `/workflows/${encodeURIComponent(id)}/status`,
      tenantId: req.tenantId,
      body: body as unknown as Record<string, unknown>,
    });
  }

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
    @Param("id") id: string
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
    @Query() query: Record<string, string>
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: "/workflows/executions",
      tenantId: req.tenantId,
      query,
    });
  }

  /**
   * Tenant-wide summary: active definitions, failing definitions,
   * execution counts by status for 24h/7d windows, and top definitions
   * by execution count. Declared before `@Get(":id")` so Nest does not
   * match `summary` as a workflow id.
   */
  @Get("summary")
  async getSummary(@Req() req: ITenantScopedRequest) {
    return this.proxy.proxy({
      method: "GET",
      path: "/workflows/summary",
      tenantId: req.tenantId,
    });
  }

  @Get(":id")
  async getWorkflow(@Req() req: ITenantScopedRequest, @Param("id") id: string) {
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
    @Param("id") id: string
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
    @Body() body: ExecuteWorkflowGatewayDto
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
    @Query() query: Record<string, string>
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
    @Param("executionId") executionId: string
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: `/workflows/${encodeURIComponent(id)}/executions/${encodeURIComponent(executionId)}`,
      tenantId: req.tenantId,
    });
  }

  /**
   * T07 of manual-loops/admin-console/console-redesign-builder-v2.md — first
   * hop of the per-node stats join ("T06 findings" in that SPEC): proxies
   * workflow-service's `GET /workflows/:id/correlation-ids`.
   */
  @Get(":id/correlation-ids")
  async getCorrelationIds(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: `/workflows/${encodeURIComponent(id)}/correlation-ids`,
      tenantId: req.tenantId,
    });
  }
}
