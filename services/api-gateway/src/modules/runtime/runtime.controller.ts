import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import { RuntimeProxyService } from "./runtime-proxy.service";
import { CreateExecutionDto } from "./runtime.dto";
import { ApiTags } from "@nestjs/swagger";

@ApiTags("runtime")
@Controller("runtime/executions")
export class RuntimeController {
  constructor(private readonly proxy: RuntimeProxyService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async createExecution(
    @Req() req: ITenantScopedRequest,
    @Body() body: CreateExecutionDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: "/runtime/executions",
      tenantId: req.tenantId,
      body,
      trustedUserId: req.user?.sub,
    });
  }

  @Get(":id")
  async getExecution(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: `/runtime/executions/${id}`,
      tenantId: req.tenantId,
      trustedUserId: req.user?.sub,
    });
  }
}
