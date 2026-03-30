import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { WorkflowProxyService } from "./workflow-proxy.service";
import { REQUEST_TENANT_KEY } from "../../guards/tenant.guard";

@Controller("workflows")
export class WorkflowsController {
  constructor(private readonly proxy: WorkflowProxyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createWorkflow(
    @Req() req: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return this.proxy.proxy(
      "POST",
      "/workflows",
      req[REQUEST_TENANT_KEY] as string,
      body,
    );
  }

  @Get()
  async listWorkflows(
    @Req() req: Record<string, unknown>,
  ) {
    return this.proxy.proxy(
      "GET",
      "/workflows",
      req[REQUEST_TENANT_KEY] as string,
    );
  }

  @Get(":id")
  async getWorkflow(
    @Req() req: Record<string, unknown>,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy(
      "GET",
      `/workflows/${encodeURIComponent(id)}`,
      req[REQUEST_TENANT_KEY] as string,
    );
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteWorkflow(
    @Req() req: Record<string, unknown>,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy(
      "DELETE",
      `/workflows/${encodeURIComponent(id)}`,
      req[REQUEST_TENANT_KEY] as string,
    );
  }

  @Post(":id/execute")
  @HttpCode(HttpStatus.ACCEPTED)
  async executeWorkflow(
    @Req() req: Record<string, unknown>,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.proxy.proxy(
      "POST",
      `/workflows/${encodeURIComponent(id)}/execute`,
      req[REQUEST_TENANT_KEY] as string,
      body,
    );
  }

  @Get(":id/executions")
  async listExecutions(
    @Req() req: Record<string, unknown>,
    @Param("id") id: string,
  ) {
    return this.proxy.proxy(
      "GET",
      `/workflows/${encodeURIComponent(id)}/executions`,
      req[REQUEST_TENANT_KEY] as string,
    );
  }

  @Get(":id/executions/:executionId")
  async getExecutionStatus(
    @Req() req: Record<string, unknown>,
    @Param("id") id: string,
    @Param("executionId") executionId: string,
  ) {
    return this.proxy.proxy(
      "GET",
      `/workflows/${encodeURIComponent(id)}/executions/${encodeURIComponent(executionId)}`,
      req[REQUEST_TENANT_KEY] as string,
    );
  }
}
