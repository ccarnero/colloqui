import type { MessageEvent } from "@nestjs/common";
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Sse,
} from "@nestjs/common";
import { TENANT_HEADER } from "@yoizen/shared";
import type { FastifyRequest } from "fastify";
import type { Observable } from "rxjs";
// biome-ignore-start lint/style/useImportType: CreateExecutionDto is a @Body() metatype and ExecutionsService is constructor-injected by NestJS DI — both must be value imports so Nest's runtime metadata (ValidationPipe metatype / design:paramtypes) resolves the real class, not `type`.
import { CreateExecutionDto } from "./executions.dto";
import { ExecutionsService } from "./executions.service";

// biome-ignore-end lint/style/useImportType

const YOIZEN_USER_ID_HEADER = "x-yoizen-user-id";

@Controller("runtime/executions")
export class ExecutionsController {
  constructor(private readonly executions: ExecutionsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(
    @Headers(TENANT_HEADER) tenantId: string,
    @Headers(YOIZEN_USER_ID_HEADER) requestedBy: string | undefined,
    @Body() dto: CreateExecutionDto
  ): Promise<{ executionId: string; status: string }> {
    return this.executions.submitExecution(tenantId, dto, requestedBy);
  }

  @Get(":id")
  async getOne(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("id") executionId: string
  ) {
    return this.executions.getExecution(tenantId, executionId);
  }

  @Sse("stream")
  stream(
    @Headers(TENANT_HEADER) tenantId: string,
  ): Observable<MessageEvent> {
    return this.executions.streamExecutionEvents(tenantId);
  }

  /**
   * Combined submit + stream (DOCS/architecture/runtime-streaming.md §2.1,
   * §3.3). Generates the executionId and subscribes to its token/lifecycle
   * subjects BEFORE submitting — race-free, unlike "POST then GET stream by
   * id". `@Sse` (RxJS) is used per the design's recommendation; teardown on
   * client disconnect publishes the `cancel` control message.
   */
  @Post("stream")
  @Sse()
  submitAndStream(
    @Headers(TENANT_HEADER) tenantId: string,
    @Headers(YOIZEN_USER_ID_HEADER) requestedBy: string | undefined,
    @Body() dto: CreateExecutionDto,
    @Req() req: FastifyRequest
  ): Observable<MessageEvent> {
    // The raw socket is shared between request and response; its
    // writableLength is the true backpressure signal for the SSE relay.
    return this.executions.submitAndStream(
      tenantId,
      dto,
      requestedBy,
      req.raw.socket
    );
  }
}
