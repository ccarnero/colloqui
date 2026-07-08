import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  IStringIdDoc,
  TenantMongoConnectionManager,
} from "@yoizen/database";
import type { Document, WithId } from "mongodb";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";
import { TenantScopedMongoRepository } from "../../providers/tenant-scoped.repository";
import type {
  ICreateMcpServerData,
  IMcpServer,
  IMcpServersRepository,
  IUpdateMcpServerData,
} from "./mcp-servers.repository.interface";

function docToMcpServer(doc: WithId<IStringIdDoc>): IMcpServer {
  return {
    id: String(doc._id),
    tenant_id: String(doc.tenant_id ?? ""),
    name: String(doc.name ?? ""),
    description:
      doc.description === null || doc.description === undefined
        ? null
        : String(doc.description),
    transport_type: String(doc.transport_type ?? "http") as "http" | "sse",
    url: String(doc.url ?? ""),
    headers: (doc.headers as Record<string, string> | null) ?? null,
    auth_type: (doc.auth_type as IMcpServer["auth_type"]) ?? "none",
    auth_config: (doc.auth_config as Record<string, unknown> | null) ?? null,
    enabled: Boolean(doc.enabled ?? true),
    is_active: Boolean(doc.is_active ?? true),
    managed_by:
      doc.managed_by === null || doc.managed_by === undefined
        ? null
        : String(doc.managed_by),
    managed_locked_fields:
      (doc.managed_locked_fields as string[] | null) ?? null,
    created_at:
      doc.created_at instanceof Date
        ? doc.created_at
        : new Date(String(doc.created_at ?? Date.now())),
    updated_at:
      doc.updated_at instanceof Date
        ? doc.updated_at
        : new Date(String(doc.updated_at ?? Date.now())),
  };
}

@Injectable()
export class McpServersMongoRepository
  extends TenantScopedMongoRepository
  implements IMcpServersRepository
{
  constructor(
    @Inject(YoizenclawTenantConnectionManager)
    connectionManager: TenantMongoConnectionManager,
  ) {
    super(connectionManager);
  }

  async findAll(tenantId: string): Promise<IMcpServer[]> {
    const db = await this.getDb(tenantId);
    const docs = await db
      .collection<IStringIdDoc>("mcp_servers")
      .find({ tenant_id: tenantId, is_active: true })
      .sort({ created_at: -1 })
      .toArray();

    return docs.map(docToMcpServer);
  }

  async findById(tenantId: string, id: string): Promise<IMcpServer | null> {
    const db = await this.getDb(tenantId);
    const doc = await db.collection<IStringIdDoc>("mcp_servers").findOne({
      _id: id,
      tenant_id: tenantId,
      is_active: true,
    });

    return doc ? docToMcpServer(doc) : null;
  }

  async create(
    tenantId: string,
    data: ICreateMcpServerData
  ): Promise<IMcpServer> {
    const db = await this.getDb(tenantId);
    const now = new Date();
    const doc = {
      _id: randomUUID(),
      tenant_id: tenantId,
      name: data.name,
      description: data.description ?? null,
      transport_type: data.transport_type,
      url: data.url,
      headers: data.headers ?? {},
      auth_type: data.auth_type ?? "none",
      auth_config: data.auth_config ?? null,
      enabled: data.enabled ?? true,
      is_active: true,
      managed_by: null,
      managed_locked_fields: null,
      created_at: now,
      updated_at: now,
    };

    await db.collection<IStringIdDoc>("mcp_servers").insertOne(doc);
    return docToMcpServer(doc as WithId<IStringIdDoc>);
  }

  async update(
    tenantId: string,
    id: string,
    data: IUpdateMcpServerData
  ): Promise<IMcpServer | null> {
    const db = await this.getDb(tenantId);
    const setFields: Document = { updated_at: new Date() };

    if (data.name !== undefined) {
      setFields.name = data.name;
    }
    if (data.description !== undefined) {
      setFields.description = data.description;
    }
    if (data.transport_type !== undefined) {
      setFields.transport_type = data.transport_type;
    }
    if (data.url !== undefined) {
      setFields.url = data.url;
    }
    if (data.headers !== undefined) {
      setFields.headers = data.headers;
    }
    if (data.auth_type !== undefined) {
      setFields.auth_type = data.auth_type;
    }
    if (data.auth_config !== undefined) {
      setFields.auth_config = data.auth_config;
    }
    if (data.enabled !== undefined) {
      setFields.enabled = data.enabled;
    }
    if (data.managed_by !== undefined) {
      setFields.managed_by = data.managed_by;
    }
    if (data.managed_locked_fields !== undefined) {
      setFields.managed_locked_fields = data.managed_locked_fields;
    }

    if (Object.keys(setFields).length > 1) {
      await db
        .collection<IStringIdDoc>("mcp_servers")
        .updateOne(
          { _id: id, tenant_id: tenantId, is_active: true },
          { $set: setFields }
        );
    }

    return this.findById(tenantId, id);
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const db = await this.getDb(tenantId);
    const result = await db
      .collection<IStringIdDoc>("mcp_servers")
      .updateOne(
        { _id: id, tenant_id: tenantId, is_active: true },
        { $set: { is_active: false, updated_at: new Date() } }
      );

    return result.modifiedCount > 0;
  }
}
