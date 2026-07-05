import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
// biome-ignore-start lint/style/useImportType: CreateExecutionDto is a @Body() metatype and RuntimeProxyService is constructor-injected by NestJS DI — both must be value imports so Nest's runtime metadata resolves the real class, not `type`.
import { CreateExecutionDto } from "./runtime.dto";
import { RuntimeProxyService } from "./runtime-proxy.service";
// biome-ignore-end lint/style/useImportType

@ApiTags("runtime")
@Controller("runtime/executions")
export class RuntimeController {
  constructor(private readonly proxy: RuntimeProxyService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async createExecution(
    @Req() req: ITenantScopedRequest,
    @Body() body: CreateExecutionDto
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
    @Param("id") id: string
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: `/runtime/executions/${id}`,
      tenantId: req.tenantId,
      trustedUserId: req.user?.sub,
    });
  }

  /**
   * Streaming passthrough (DOCS/architecture/runtime-streaming.md §3.4).
   * `@Req()`/`@Res()` (Fastify) so Nest hands us the raw reply and never
   * serializes the body — `AuthGuard`/`TenantGuard` (global `APP_GUARD`s)
   * still run since they are request-phase; `ValidationPipe` still
   * validates `CreateExecutionDto` before this handler runs. The response
   * itself is streamed by `RuntimeProxyService.proxyStream()`, which
   * `reply.hijack()`s so no interceptor/serializer touches the SSE body.
   */
  @Post("stream")
  @HttpCode(HttpStatus.OK)
  async streamExecution(
    @Req() req: ITenantScopedRequest,
    @Res() reply: FastifyReply,
    @Body() body: CreateExecutionDto
  ): Promise<void> {
    await this.proxy.proxyStream(reply, {
      tenantId: req.tenantId,
      body,
      trustedUserId: req.user?.sub,
    });
  }
}
