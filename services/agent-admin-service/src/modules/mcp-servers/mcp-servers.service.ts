import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type {
  CreateMcpServerDto,
  RecordMcpUsageEventDto,
  UpdateMcpServerDto,
} from "./mcp-servers.dto";
import {
  type IMcpServer,
  type IMcpServersRepository,
  type IUpdateMcpServerData,
  MCP_SERVERS_REPOSITORY,
} from "./mcp-servers.repository.interface";
import type {
  IMcpTestConnectionResult,
  IMcpToolSummary,
} from "./mcp-tools-probe.service";
// biome-ignore lint/style/useImportType: constructor-injected — Nest DI needs the runtime class reference.
import { McpToolsProbeService } from "./mcp-tools-probe.service";
import {
  type IMcpUsage,
  type IMcpUsageRepository,
  MCP_USAGE_REPOSITORY,
} from "./mcp-usage.repository.interface";

/** Default aggregation window for `GET :id/usage`, mirrors `GET /connectors/usage`'s default. */
const DEFAULT_USAGE_WINDOW_DAYS = 7;
/** Max "Recent calls" rows returned, mirrors the connector detail page's recent-calls cap. */
const USAGE_RECENT_CALLS_LIMIT = 20;

/**
 * DTO keys whose values are owned by an external sync lifecycle (e.g. a
 * future internal-registry auto-discovery producer, mcp-connections.md
 * §0.4). Editing any of these on a managed MCP server is rejected because
 * the next sync event would silently overwrite the change. Ported verbatim
 * from `adapters.service.ts`'s `REGISTRY_OWNED_FIELD_KEYS` pattern, but
 * scoped to `name`/`url`/`transport_type` only — unlike adapters, `headers`
 * and auth stay editable even on managed MCP servers, since credentials
 * shouldn't be registry-sourced (mcp-connections.md §2.3).
 */
const REGISTRY_OWNED_FIELD_KEYS: ReadonlySet<string> = new Set([
  "name",
  "url",
  "transport_type",
]);

/** Every DTO key `assertManagedFieldsEditable` can lock, for the "editable" list in the 409 body. */
const ALL_UPDATE_FIELD_KEYS: readonly string[] = [
  "name",
  "description",
  "transport_type",
  "url",
  "headers",
  "authType",
  "authConfig",
  "enabled",
];

const MANAGED_EDITABLE_FIELD_KEYS: readonly string[] =
  ALL_UPDATE_FIELD_KEYS.filter((key) => !REGISTRY_OWNED_FIELD_KEYS.has(key));

/** Structured 409 body for managed-MCP-server conflicts (UI-consumable), mirrors `IManagedAdapterConflict`. */
interface IManagedMcpServerConflict {
  readonly statusCode: 409;
  readonly error: "Conflict";
  readonly reason: "MANAGED_MCP_SERVER";
  readonly message: string;
  readonly mcpServerId: string;
  readonly managedBy: string;
  readonly lockedFields: readonly string[];
  readonly editableFields: readonly string[];
}

@Injectable()
export class McpServersService {
  private readonly logger = new PinoLoggerService(McpServersService.name);

  constructor(
    @Inject(MCP_SERVERS_REPOSITORY)
    private readonly repository: IMcpServersRepository,
    private readonly toolsProbe: McpToolsProbeService,
    @Inject(MCP_USAGE_REPOSITORY)
    private readonly usageRepository: IMcpUsageRepository,
  ) {}

  async findAll(tenantId: string): Promise<IMcpServer[]> {
    return this.repository.findAll(tenantId);
  }

  async findById(tenantId: string, id: string): Promise<IMcpServer> {
    const server = await this.repository.findById(tenantId, id);
    if (!server) {
      throw new NotFoundException(`MCP server '${id}' not found`);
    }
    return server;
  }

  async create(tenantId: string, dto: CreateMcpServerDto): Promise<IMcpServer> {
    await this.assertNameAvailable(tenantId, dto.name);
    return this.repository.create(tenantId, {
      name: dto.name,
      description: dto.description,
      transport_type: dto.transport_type,
      url: dto.url,
      headers: dto.headers,
      auth_type: dto.authType,
      auth_config: dto.authConfig,
      enabled: dto.enabled,
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateMcpServerDto
  ): Promise<IMcpServer> {
    const existing = await this.findById(tenantId, id);
    this.assertManagedFieldsEditable(id, existing.managed_by, dto);
    if (dto.name !== undefined && dto.name !== existing.name) {
      await this.assertNameAvailable(tenantId, dto.name, id);
    }

    const data: IUpdateMcpServerData = {
      name: dto.name,
      description: dto.description,
      transport_type: dto.transport_type,
      url: dto.url,
      headers: dto.headers,
      auth_type: dto.authType,
      auth_config: dto.authConfig,
      enabled: dto.enabled,
    };

    const server = await this.repository.update(tenantId, id, data);
    if (!server) {
      throw new NotFoundException(`MCP server '${id}' not found`);
    }
    return server;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const deleted = await this.repository.delete(tenantId, id);
    if (!deleted) {
      throw new NotFoundException(`MCP server '${id}' not found`);
    }
  }

  /**
   * Lists the tools exposed by a live MCP server (mcp-connections.md §2.4).
   * Connects transiently (no persistence side-effect, no pooled connection)
   * — this is a read/display concern for the admin UI, not the long-lived
   * per-tenant runtime connection `agent-ai-service`'s
   * `mcp-connection.service.ts` maintains for actual tool execution.
   */
  async listTools(tenantId: string, id: string): Promise<IMcpToolSummary[]> {
    const server = await this.findById(tenantId, id);
    return this.toolsProbe.listTools(server);
  }

  /**
   * Live connectivity test (mcp-connections.md §2.2). No persistence
   * side-effect — reuses the same transient probe as {@link listTools}.
   */
  async testConnection(
    tenantId: string,
    id: string
  ): Promise<IMcpTestConnectionResult> {
    const server = await this.findById(tenantId, id);
    return this.toolsProbe.testConnection(server);
  }

  /**
   * Records an MCP tool-call usage event (mcp-connections.md §3). Called by
   * `POST admin/mcp-servers/usage-events` — service-to-service only, hit by
   * `agent-ai-service`'s `tool-bridge.service.ts` (and, later,
   * `connector-runtime`'s `mcp-call.activity.ts`) via
   * `@yoizen/shared`'s `reportMcpUsageEvent`.
   *
   * Best-effort resolves `mcpServerId` from `serverName` when the caller
   * doesn't already know it — never throws on an unresolved/deleted server;
   * the event is still recorded (with a null `mcp_server_id`) since the
   * usage fact itself is still worth keeping, it just won't show up on any
   * particular server's detail page.
   */
  async recordUsageEvent(
    tenantId: string,
    dto: RecordMcpUsageEventDto
  ): Promise<void> {
    let mcpServerId = dto.mcpServerId ?? null;
    if (!mcpServerId) {
      const servers = await this.repository.findAll(tenantId);
      mcpServerId = servers.find((s) => s.name === dto.serverName)?.id ?? null;
    }

    await this.usageRepository.record(tenantId, {
      eventId: dto.eventId,
      mcpServerId,
      serverName: dto.serverName,
      toolName: dto.toolName,
      success: dto.success,
      durationMs: dto.durationMs,
      error: dto.error,
      correlationId: dto.correlationId,
      causationId: dto.causationId,
      executionId: dto.executionId,
    });
  }

  /**
   * Usage summary + recent calls for the MCP detail page's Overview cards
   * and "Recent calls" section (mcp-connections.md §3, §6.3), mirroring
   * `GET /connectors/usage`'s response shape as closely as sensible while
   * also covering the per-server "recent calls" list that page needs (which,
   * for Connectors, is served by a separate audit-events endpoint — MCP
   * usage keeps both concerns in one endpoint since it's a much smaller,
   * dedicated table rather than a shared cross-tenant audit stream).
   */
  async getUsage(
    tenantId: string,
    id: string,
    windowDays = DEFAULT_USAGE_WINDOW_DAYS
  ): Promise<IMcpUsage> {
    await this.findById(tenantId, id);
    return this.usageRepository.getUsage(
      tenantId,
      id,
      windowDays,
      USAGE_RECENT_CALLS_LIMIT
    );
  }

  /**
   * Guards `name` uniqueness per tenant. There is no DB-level unique
   * constraint on `mcp_servers.name` (only a non-unique index on
   * `tenant_id`), but `enabled_mcp_servers`/`enabled_mcp_tools` (per-agent
   * MCP filtering, mcp-connections.md §4/§5) and the runtime connection
   * layer (`McpClientService.connect()`, keyed by server `name`, one client
   * per name) all treat `name` as the effective per-tenant identity for a
   * live MCP server. Enforcing uniqueness here at write time is what makes
   * that name-keying safe, since two servers sharing a name would otherwise
   * silently collide (the second `connect()` call is a no-op, and
   * `enabled_mcp_servers`/`enabled_mcp_tools` couldn't tell the two apart).
   */
  private async assertNameAvailable(
    tenantId: string,
    name: string,
    excludeId?: string
  ): Promise<void> {
    const servers = await this.repository.findAll(tenantId);
    const collision = servers.find(
      (s) => s.name === name && s.id !== excludeId
    );
    if (collision) {
      throw new ConflictException(
        `An MCP server named '${name}' already exists for this tenant. ` +
          "Server names must be unique per tenant."
      );
    }
  }

  /**
   * Field-level guard for managed MCP servers. Unmanaged servers pass
   * through untouched. For managed servers, only the registry-owned fields
   * ({@link REGISTRY_OWNED_FIELD_KEYS}) are locked; the conflict names
   * exactly which fields were rejected and which remain editable.
   */
  private assertManagedFieldsEditable(
    id: string,
    managedBy: string | null,
    dto: UpdateMcpServerDto
  ): void {
    if (!managedBy) {
      return;
    }
    const lockedFields: string[] = [];
    for (const key of REGISTRY_OWNED_FIELD_KEYS) {
      if ((dto as Record<string, unknown>)[key] !== undefined) {
        lockedFields.push(key);
      }
    }
    if (lockedFields.length === 0) {
      return;
    }
    const body: IManagedMcpServerConflict = {
      statusCode: 409,
      error: "Conflict",
      reason: "MANAGED_MCP_SERVER",
      message:
        `MCP server '${id}' is synced from '${managedBy}'. ` +
        `These fields are controlled by the sync and can't be edited here: ` +
        `${lockedFields.join(", ")}. ` +
        `You can still edit: ${MANAGED_EDITABLE_FIELD_KEYS.join(", ")}.`,
      mcpServerId: id,
      managedBy,
      lockedFields,
      editableFields: MANAGED_EDITABLE_FIELD_KEYS,
    };
    throw new ConflictException(body);
  }
}
