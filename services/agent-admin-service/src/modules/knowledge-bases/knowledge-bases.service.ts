import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { TenantConnectionManager } from "@yoizen/database";
import type { JsonValue } from "@yoizen/shared";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";

export interface IIngestionConfig {
  chunk_size?: number;
  chunk_overlap?: number;
  embedding_model?: string;
  provider_connector_id?: string;
  chunking_strategy?: "character" | "recursive" | "semantic" | "title_segmentation";
  api_key?: string;
  provider?: string;
  api_base_url?: string;
  api_version?: string;
}

export interface IKnowledgeBaseRow {
  id: string;
  name: string;
  description: string | null;
  project: string | null;
  category: string | null;
  icon: string;
  ingestion_config: IIngestionConfig | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class KnowledgeBasesService {
  private readonly logger = new Logger(KnowledgeBasesService.name);

  constructor(
    @Inject(YoizenclawTenantConnectionManager)
    private readonly connectionManager: TenantConnectionManager,
  ) {}

  async findAll(
    tenantId: string,
  ): Promise<{ knowledge_bases: IKnowledgeBaseRow[]; total: number }> {
    const sql = await this.connectionManager.ensureSchema(tenantId);
    const [countRow] = await sql`
      SELECT COUNT(*) as count FROM knowledge_bases WHERE tenant_id = ${tenantId} AND is_active = true
    `;
    const total = Number((countRow as Record<string, unknown>).count ?? 0);
    const knowledge_bases = await sql<IKnowledgeBaseRow[]>`
      SELECT id, name, description, project, category, icon, ingestion_config, is_active, created_at, updated_at
      FROM knowledge_bases
      WHERE tenant_id = ${tenantId} AND is_active = true
      ORDER BY name
    `;
    return { knowledge_bases, total };
  }

  async findById(
    tenantId: string,
    id: string,
  ): Promise<IKnowledgeBaseRow | null> {
    const sql = await this.connectionManager.ensureSchema(tenantId);
    const [row] = await sql<IKnowledgeBaseRow[]>`
      SELECT id, name, description, project, category, icon, ingestion_config, is_active, created_at, updated_at
      FROM knowledge_bases
      WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true
      LIMIT 1
    `;
    return row ?? null;
  }

  async create(
    tenantId: string,
    data: {
      name: string;
      description?: string;
      project?: string;
      category?: string;
      icon?: string;
      ingestion_config?: IIngestionConfig;
    },
  ): Promise<IKnowledgeBaseRow> {
    const sql = await this.connectionManager.ensureSchema(tenantId);
    const id = randomUUID();
    const [row] = await sql<IKnowledgeBaseRow[]>`
      INSERT INTO knowledge_bases (id, tenant_id, name, description, project, category, icon, ingestion_config)
      VALUES (
        ${id},
        ${tenantId},
        ${data.name},
        ${data.description ?? null},
        ${data.project ?? null},
        ${data.category ?? null},
        ${data.icon ?? "library_books"},
        ${sql.json((data.ingestion_config ?? {}) as JsonValue)}
      )
      RETURNING id, name, description, project, category, icon, ingestion_config, is_active, created_at, updated_at
    `;
    return row;
  }

  async update(
    tenantId: string,
    id: string,
    data: {
      name?: string;
      description?: string;
      project?: string;
      category?: string;
      icon?: string;
      ingestion_config?: IIngestionConfig;
    },
  ): Promise<IKnowledgeBaseRow | null> {
    const sql = await this.connectionManager.ensureSchema(tenantId);

    // Build dynamic SET clauses using parameterized fragments
    const setClauses: string[] = ["updated_at = NOW()"];

    if (data.name !== undefined) {
      setClauses.push(sql`name = ${data.name}` as unknown as string);
    }
    if (data.description !== undefined) {
      setClauses.push(
        sql`description = ${data.description}` as unknown as string,
      );
    }
    if (data.project !== undefined) {
      setClauses.push(sql`project = ${data.project}` as unknown as string);
    }
    if (data.category !== undefined) {
      setClauses.push(sql`category = ${data.category}` as unknown as string);
    }
    if (data.icon !== undefined) {
      setClauses.push(sql`icon = ${data.icon}` as unknown as string);
    }
    const setClause = setClauses.join(", ");

    if (data.ingestion_config !== undefined) {
      await sql`
        UPDATE knowledge_bases
        SET ingestion_config = ${sql.json(data.ingestion_config as JsonValue)}, updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true
      `;
    }

    const [row] = await sql<IKnowledgeBaseRow[]>`
      UPDATE knowledge_bases
      SET ${sql.unsafe(setClause)}
      WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true
      RETURNING id, name, description, project, category, icon, ingestion_config, is_active, created_at, updated_at
    `;

    return row ?? null;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const sql = await this.connectionManager.ensureSchema(tenantId);
    const result = await sql`
      UPDATE knowledge_bases
      SET is_active = false, updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true
      RETURNING id
    `;
    return result.length > 0;
  }
}
// force rebuild dom 07 jun 2026 15:06:32 -03
