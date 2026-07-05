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
  Query,
  Req,
} from "@nestjs/common";
import { AgentMemoryProxyService } from "./agent-memory-proxy.service";
import {
  AdminMemoryListQueryDto,
  CreateMemoryDto,
  MemoryIdParamDto,
  UpdateMemoryDto,
} from "./admin.dto";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import { ApiTags } from "@nestjs/swagger";

@ApiTags("memories")
@Controller("admin/memories")
export class AdminMemoriesController {
  constructor(private readonly proxy: AgentMemoryProxyService) {}

  @Get()
  async list(
    @Req() req: ITenantScopedRequest,
    @Query() query: AdminMemoryListQueryDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: "/admin/memories",
      tenantId: req.tenantId,
      query: {
        scope: query.scope,
        kind: query.kind,
        status: query.status,
        search: query.search,
        limit: query.limit?.toString(),
        offset: query.offset?.toString(),
        includeExpired: query.includeExpired?.toString(),
        sessionId: query.sessionId,
        userId: query.userId,
        context: query.context,
      },
      trustedUserId: req.user?.sub,
    });
  }

  @Get("proposals")
  async proposals(
    @Req() req: ITenantScopedRequest,
    @Query() query: AdminMemoryListQueryDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: "/admin/memories/proposals",
      tenantId: req.tenantId,
      query: {
        scope: query.scope,
        kind: query.kind,
        search: query.search,
        limit: query.limit?.toString(),
        offset: query.offset?.toString(),
      },
      trustedUserId: req.user?.sub,
    });
  }

  @Get(":id")
  async getOne(
    @Req() req: ITenantScopedRequest,
    @Param() params: MemoryIdParamDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: `/admin/memories/${params.id}`,
      tenantId: req.tenantId,
      trustedUserId: req.user?.sub,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() req: ITenantScopedRequest,
    @Body() body: CreateMemoryDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "POST",
      path: "/admin/memories",
      tenantId: req.tenantId,
      body,
      trustedUserId: req.user?.sub,
    });
  }

  @Patch(":id")
  async update(
    @Req() req: ITenantScopedRequest,
    @Param() params: MemoryIdParamDto,
    @Body() body: UpdateMemoryDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "PATCH",
      path: `/admin/memories/${params.id}`,
      tenantId: req.tenantId,
      body,
      trustedUserId: req.user?.sub,
    });
  }

  @Patch(":id/approve")
  async approve(
    @Req() req: ITenantScopedRequest,
    @Param() params: MemoryIdParamDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "PATCH",
      path: `/admin/memories/${params.id}/approve`,
      tenantId: req.tenantId,
      trustedUserId: req.user?.sub,
    });
  }

  @Patch(":id/reject")
  async reject(
    @Req() req: ITenantScopedRequest,
    @Param() params: MemoryIdParamDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "PATCH",
      path: `/admin/memories/${params.id}/reject`,
      tenantId: req.tenantId,
      trustedUserId: req.user?.sub,
    });
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Req() req: ITenantScopedRequest,
    @Param() params: MemoryIdParamDto,
  ): Promise<object> {
    return this.proxy.proxy({
      method: "DELETE",
      path: `/admin/memories/${params.id}`,
      tenantId: req.tenantId,
      trustedUserId: req.user?.sub,
    });
  }
}
