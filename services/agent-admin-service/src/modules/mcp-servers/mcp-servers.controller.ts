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
  UseGuards,
} from "@nestjs/common";
import { TenantGuard } from "../../guards/tenant.guard";
import { TenantId } from "../../providers/tenant.decorator";
// biome-ignore lint/style/useImportType: used as @Body() metatype — needed at runtime for ValidationPipe's class-validator/class-transformer reflection.
import {
  CreateMcpServerDto,
  RecordMcpUsageEventDto,
  UpdateMcpServerDto,
} from "./mcp-servers.dto";
import type { IMcpServer } from "./mcp-servers.repository.interface";
// biome-ignore lint/style/useImportType: constructor-injected — Nest DI needs the runtime class reference.
import { McpServersService } from "./mcp-servers.service";
import type {
  IMcpTestConnectionResult,
  IMcpToolSummary,
} from "./mcp-tools-probe.service";
import type { IMcpUsage } from "./mcp-usage.repository.interface";

@Controller("admin/mcp-servers")
@UseGuards(TenantGuard)
export class McpServersController {
  constructor(private readonly service: McpServersService) {}

  @Get()
  async findAll(@TenantId() tenantId: string): Promise<IMcpServer[]> {
    return this.service.findAll(tenantId);
  }

  /**
   * Service-to-service write endpoint (mcp-connections.md §3). Called by
   * `agent-ai-service`'s `tool-bridge.service.ts` (and, later,
   * `connector-runtime`'s `mcp-call.activity.ts`) via `@yoizen/shared`'s
   * `reportMcpUsageEvent` — fire-and-forget, never awaited by the caller.
   * Declared before `:id` routes, as a literal sibling segment of the
   * collection root (`usage-events`, not `:id/usage-events`) since the
   * caller only reliably knows the server *name* at tool-execution time, not
   * always its id (see `RecordMcpUsageEventDto`). Not proxied through
   * api-gateway — internal service traffic only.
   */
  @Post("usage-events")
  @HttpCode(HttpStatus.ACCEPTED)
  async recordUsageEvent(
    @TenantId() tenantId: string,
    @Body() dto: RecordMcpUsageEventDto
  ): Promise<void> {
    await this.service.recordUsageEvent(tenantId, dto);
  }

  @Get(":id")
  async findById(
    @TenantId() tenantId: string,
    @Param("id") id: string
  ): Promise<IMcpServer> {
    return this.service.findById(tenantId, id);
  }

  /**
   * Live `tools/list` probe against the MCP server (mcp-connections.md
   * §2.4). Declared before nothing conflicting — `:id/tools` cannot be
   * confused with a bare `:id` since Nest matches the longer, more specific
   * path segment first regardless of declaration order for this shape.
   */
  @Get(":id/tools")
  async listTools(
    @TenantId() tenantId: string,
    @Param("id") id: string
  ): Promise<IMcpToolSummary[]> {
    return this.service.listTools(tenantId, id);
  }

  /**
   * Usage summary + recent calls for the MCP detail page (mcp-connections.md
   * §3, §6.3), mirroring `GET /connectors/usage`'s response shape. `window`
   * is a day count, same query param name/semantics as the connector
   * endpoint (parsed the same defensive way — invalid/missing falls back to
   * the service's default).
   */
  @Get(":id/usage")
  async getUsage(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Query("window") window?: string
  ): Promise<IMcpUsage> {
    const windowDays = window
      ? Math.max(1, parseInt(window, 10) || 7)
      : undefined;
    return this.service.getUsage(tenantId, id, windowDays);
  }

  /**
   * Live connectivity test (mcp-connections.md §2.2). No persistence
   * side-effect — `is_active` is unaffected. Declared before `@Get(":id")`
   * for readability; Nest still matches `:id/test` as the more specific
   * path regardless of declaration order.
   */
  @Post(":id/test")
  @HttpCode(HttpStatus.OK)
  async testConnection(
    @TenantId() tenantId: string,
    @Param("id") id: string
  ): Promise<IMcpTestConnectionResult> {
    return this.service.testConnection(tenantId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @TenantId() tenantId: string,
    @Body() dto: CreateMcpServerDto
  ): Promise<IMcpServer> {
    return this.service.create(tenantId, dto);
  }

  /**
   * `PATCH`, not `PUT` — fixed per mcp-connections.md §2.1 for consistency
   * with the rest of the admin API (every other admin resource's partial
   * update uses `PATCH`). Confirmed no external consumer depends on `PUT`:
   * grepped `sdk/` and `services/api-gateway` — the gateway's
   * `AdminMcpServersController.updateMcpServer` also used `PUT` and was
   * updated in the same change (see admin-mcp-servers.controller.ts).
   */
  @Patch(":id")
  async update(
    @TenantId() tenantId: string,
    @Param("id") id: string,
    @Body() dto: UpdateMcpServerDto
  ): Promise<IMcpServer> {
    return this.service.update(tenantId, id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @TenantId() tenantId: string,
    @Param("id") id: string
  ): Promise<void> {
    await this.service.delete(tenantId, id);
  }
}
