import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Sse,
  Body,
} from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import type { Observable } from "rxjs";
import { TENANT_HEADER } from "@yoizen/shared";
import { ExecutionsService } from "./executions.service";
import { CreateExecutionDto } from "./executions.dto";

const YOIZEN_USER_ID_HEADER = "x-yoizen-user-id";

@Controller("runtime/executions")
export class ExecutionsController {
  constructor(private readonly executions: ExecutionsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(
    @Headers(TENANT_HEADER) tenantId: string,
    @Headers(YOIZEN_USER_ID_HEADER) requestedBy: string | undefined,
    @Body() dto: CreateExecutionDto,
  ): Promise<{ executionId: string; status: string }> {
    return this.executions.submitExecution(tenantId, dto, requestedBy);
  }

  @Get(":id")
  async getOne(
    @Headers(TENANT_HEADER) tenantId: string,
    @Param("id") executionId: string,
  ) {
    return this.executions.getExecution(tenantId, executionId);
  }

  @Sse("stream")
  stream(
    @Headers(TENANT_HEADER) tenantId: string,
  ): Observable<MessageEvent> {
    return this.executions.streamExecutionEvents(tenantId);
  }
}
