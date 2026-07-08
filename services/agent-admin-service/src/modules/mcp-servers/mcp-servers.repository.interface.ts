export const MCP_SERVERS_REPOSITORY = Symbol("MCP_SERVERS_REPOSITORY");

export type McpServerAuthType = "none" | "api-key" | "bearer" | "basic";

export interface IMcpServer {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  transport_type: "http" | "sse";
  url: string;
  headers: Record<string, string> | null;
  auth_type: McpServerAuthType;
  auth_config: Record<string, unknown> | null;
  enabled: boolean;
  is_active: boolean;
  managed_by: string | null;
  managed_locked_fields: string[] | null;
  created_at: Date;
  updated_at: Date;
}

export interface ICreateMcpServerData {
  name: string;
  description?: string;
  transport_type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
  auth_type?: McpServerAuthType;
  auth_config?: Record<string, unknown> | null;
  enabled?: boolean;
}

export interface IUpdateMcpServerData {
  name?: string;
  description?: string | null;
  transport_type?: "http" | "sse";
  url?: string;
  headers?: Record<string, string> | null;
  auth_type?: McpServerAuthType;
  auth_config?: Record<string, unknown> | null;
  enabled?: boolean;
  managed_by?: string | null;
  managed_locked_fields?: string[] | null;
}

export interface IMcpServersRepository {
  findAll(tenantId: string): Promise<IMcpServer[]>;
  findById(tenantId: string, id: string): Promise<IMcpServer | null>;
  create(tenantId: string, data: ICreateMcpServerData): Promise<IMcpServer>;
  update(
    tenantId: string,
    id: string,
    data: IUpdateMcpServerData
  ): Promise<IMcpServer | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
}
