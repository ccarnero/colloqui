import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { McpServersService } from "./mcp-servers.service";
import { CreateMcpServerDto, UpdateMcpServerDto } from "./mcp-servers.dto";
import type { IMcpServer } from "./mcp-servers.repository.interface";
import { TenantGuard } from "../../guards/tenant.guard";
import { TenantId } from "../../providers/tenant.decorator";

@Controller("admin/mcp-servers")
@UseGuards(TenantGuard)
export class McpServersController {
  constructor(private readonly service: McpServersService) {}

  @Get()
  async findAll(@TenantId() tenantId: string): Promise<IMcpServer[]> {
    return this.service.findAll(tenantId);
  }

  @Get(":id")
  async findById(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<IMcpServer> {
    return this.service.findById(tenantId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @TenantId() tenantId: string,
    @Body() dto: CreateMcpServerDto,
  ): Promise<IMcpServer> {
    return this.service.create(tenantId, dto);
  }

  @Put(":id")
  async update(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateMcpServerDto,
  ): Promise<IMcpServer> {
    return this.service.update(tenantId, id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @TenantId() tenantId: string,
    @Param("id") id: string,
  ): Promise<void> {
    await this.service.delete(tenantId, id);
  }
}
