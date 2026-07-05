import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
} from "@nestjs/common";
import { AdminProxyService } from "./admin-proxy.service";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import { ApiTags } from "@nestjs/swagger";

@ApiTags("knowledge-bases")
@Controller("admin/knowledge-bases")
export class AdminKnowledgeBasesController {
  constructor(private readonly adminProxy: AdminProxyService) {}

  @Get()
  async findAll(
    @Req() req: ITenantScopedRequest,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "GET",
      path: "/admin/knowledge-bases",
      tenantId: req.tenantId,
      query: { limit, offset },
    });
  }

  @Get(":id")
  async findById(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "GET",
      path: `/admin/knowledge-bases/${id}`,
      tenantId: req.tenantId,
    });
  }

  @Post()
  async create(
    @Req() req: ITenantScopedRequest,
    @Body() body: unknown,
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "POST",
      path: "/admin/knowledge-bases",
      tenantId: req.tenantId,
      body,
    });
  }

  @Patch(":id")
  async update(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "PATCH",
      path: `/admin/knowledge-bases/${id}`,
      tenantId: req.tenantId,
      body,
    });
  }

  @Delete(":id")
  async delete(
    @Req() req: ITenantScopedRequest,
    @Param("id") id: string,
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "DELETE",
      path: `/admin/knowledge-bases/${id}`,
      tenantId: req.tenantId,
    });
  }
}

@ApiTags("knowledge-bases")
@Controller("admin/knowledge-bases/:kbId/documents")
export class AdminKnowledgeBaseDocumentsController {
  constructor(private readonly adminProxy: AdminProxyService) {}

  @Get()
  async findAll(
    @Req() req: ITenantScopedRequest,
    @Param("kbId") kbId: string,
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "GET",
      path: `/admin/knowledge-bases/${kbId}/documents`,
      tenantId: req.tenantId,
    });
  }

  @Get(":id/chunks")
  async findChunks(
    @Req() req: ITenantScopedRequest,
    @Param("kbId") kbId: string,
    @Param("id") id: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "GET",
      path: `/admin/knowledge-bases/${kbId}/documents/${id}/chunks`,
      tenantId: req.tenantId,
      query: { page, limit },
    });
  }

  @Put(":docId/chunks/:chunkId")
  async updateChunk(
    @Req() req: ITenantScopedRequest,
    @Param("kbId") kbId: string,
    @Param("docId") docId: string,
    @Param("chunkId") chunkId: string,
    @Body() body: unknown,
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "PUT",
      path: `/admin/knowledge-bases/${kbId}/documents/${docId}/chunks/${chunkId}`,
      tenantId: req.tenantId,
      body,
    });
  }

  @Get(":id")
  async findById(
    @Req() req: ITenantScopedRequest,
    @Param("kbId") kbId: string,
    @Param("id") id: string,
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "GET",
      path: `/admin/knowledge-bases/${kbId}/documents/${id}`,
      tenantId: req.tenantId,
    });
  }

  @Post("upload")
  async upload(
    @Req() req: ITenantScopedRequest,
    @Param("kbId") kbId: string,
    @Body() body: unknown,
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "POST",
      path: `/admin/knowledge-bases/${kbId}/documents/upload`,
      tenantId: req.tenantId,
      body,
    });
  }

  @Post("upload-file")
  async uploadFile(
    @Req() req: ITenantScopedRequest,
    @Param("kbId") kbId: string,
    @Body() body: unknown,
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "POST",
      path: `/admin/knowledge-bases/${kbId}/documents/upload-file`,
      tenantId: req.tenantId,
      body,
    });
  }

  @Post(":id/reingest")
  async reingest(
    @Req() req: ITenantScopedRequest,
    @Param("kbId") kbId: string,
    @Param("id") id: string,
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "POST",
      path: `/admin/knowledge-bases/${kbId}/documents/${id}/reingest`,
      tenantId: req.tenantId,
    });
  }

  @Delete(":id")
  async delete(
    @Req() req: ITenantScopedRequest,
    @Param("kbId") kbId: string,
    @Param("id") id: string,
  ): Promise<object> {
    return this.adminProxy.proxy({
      method: "DELETE",
      path: `/admin/knowledge-bases/${kbId}/documents/${id}`,
      tenantId: req.tenantId,
    });
  }
}
