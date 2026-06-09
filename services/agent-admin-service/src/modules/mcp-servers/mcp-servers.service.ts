import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import {
  MCP_SERVERS_REPOSITORY,
  type IMcpServer,
  type IMcpServersRepository,
} from "./mcp-servers.repository.interface";
import type { CreateMcpServerDto, UpdateMcpServerDto } from "./mcp-servers.dto";

@Injectable()
export class McpServersService {
  private readonly logger = new PinoLoggerService(McpServersService.name);

  constructor(
    @Inject(MCP_SERVERS_REPOSITORY)
    private readonly repository: IMcpServersRepository,
  ) {}

  async findAll(tenantId: string): Promise<IMcpServer[]> {
    return this.repository.findAll(tenantId);
  }

  async findById(tenantId: string, id: string): Promise<IMcpServer> {
    const server = await this.repository.findById(tenantId, id);
    if (!server) throw new NotFoundException(`MCP server '${id}' not found`);
    return server;
  }

  async create(tenantId: string, dto: CreateMcpServerDto): Promise<IMcpServer> {
    return this.repository.create(tenantId, { ...dto });
  }

  async update(tenantId: string, id: string, dto: UpdateMcpServerDto): Promise<IMcpServer> {
    const server = await this.repository.update(tenantId, id, dto);
    if (!server) throw new NotFoundException(`MCP server '${id}' not found`);
    return server;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const deleted = await this.repository.delete(tenantId, id);
    if (!deleted) throw new NotFoundException(`MCP server '${id}' not found`);
  }
}
