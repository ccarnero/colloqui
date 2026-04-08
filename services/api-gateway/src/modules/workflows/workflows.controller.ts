import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { WorkflowProxyService } from "./workflow-proxy.service";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import {
  CreateWorkflowGatewayDto,
  UpdateWorkflowGatewayDto,
  ExecuteWorkflowGatewayDto,
} from "./workflows-gateway.dto";

@Controller("workflows")
export class WorkflowsController {
  constructor(private readonly proxy: WorkflowProxyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createWorkflow(
    @Req() req: ITenantScopedRequest,
    @Body() body: CreateWorkflowGatewayDto,
  ) {
    return this.proxy.proxy({
      method: "POST",
      path: "/workflows",
      tenantId: req.tenantId,
      body: body as unknown as Record<string, unknown>,
    });
  }

  @Put(":id")
  async updateWorkflow(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
    @Body() body: UpdateWorkflowGatewayDto,
  ) {
    return this.proxy.proxy({
      method: "PUT",
      path: `/workflows/${encodeURIComponent(id)}`,
      tenantId: req.tenantId,
      body: body as unknown as Record<string, unknown>,
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
    });
  }

  @Get(":id/executions")
  async listExecutions(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy({
      method: "GET",
      path: `/workflows/${encodeURIComponent(id)}/executions`,
      tenantId: req.tenantId,
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
