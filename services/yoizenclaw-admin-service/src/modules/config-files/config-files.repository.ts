import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { TenantScopedRepository } from "../../providers/tenant-scoped.repository";
import { TenantConnectionManager } from "@yoizen/database";
import {
  appendSqlSetFragment,
  composeUpdateSetClause,
} from "../../common/repository-sql.util";

export interface IConfigFile {
  id: string;
  name: string;
  path: string;
  content: string;
  format: "yaml" | "json";
  version: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ICreateConfigFileData {
  name: string;
  path: string;
  content: string;
  format: "yaml" | "json";
}

interface IUpdateConfigFileData {
  name?: string;
  content?: string;
  is_active?: boolean;
}

export interface IFindAllConfigFilesOptions {
  limit?: number;
  offset?: number;
}

@Injectable()
export class ConfigFilesRepository extends TenantScopedRepository {
  constructor(connectionManager: TenantConnectionManager) {
    super(connectionManager);
  }

  /**
   * Lists config files with pagination.
   */
  async findAll(
    tenantId: string,
    options: IFindAllConfigFilesOptions = {},
  ): Promise<{ files: IConfigFile[]; total: number }> {
    const sql = await this.getSql(tenantId);
    const { limit = 20, offset = 0 } = options;

    // Get total count
    const countResult = await sql<{ count: number }[]>`
      SELECT COUNT(*) as count FROM config_files WHERE is_active = true
    `;
    const total = Number(countResult[0].count);

    // Get files with pagination
    const files = await sql<IConfigFile[]>`
      SELECT 
        id,
        name,
        path,
        content,
        format,
        version,
        is_active,
        created_at,
        updated_at
      FROM config_files
      WHERE is_active = true
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return { files, total };
  }

  /**
   * Finds a config file by unique path.
   */
  async findByPath(tenantId: string, path: string): Promise<IConfigFile | null> {
    const sql = await this.getSql(tenantId);

    const results = await sql<IConfigFile[]>`
      SELECT 
        id,
        name,
        path,
        content,
        format,
        version,
        is_active,
        created_at,
        updated_at
      FROM config_files
      WHERE path = ${path} AND is_active = true
      LIMIT 1
    `;

    return results[0] ?? null;
  }

  /**
   * Creates a new config file.
   */
  async create(
    tenantId: string,
    data: ICreateConfigFileData,
  ): Promise<IConfigFile> {
    const sql = await this.getSql(tenantId);
    const configFileId = randomUUID();

    const results = await sql<IConfigFile[]>`
      INSERT INTO config_files (
        id,
        name,
        path,
        content,
        format,
        version,
        is_active,
        created_at,
        updated_at
      ) VALUES (
        ${configFileId},
        ${data.name},
        ${data.path},
        ${data.content},
        ${data.format},
        1,
        true,
        NOW(),
        NOW()
      )
      RETURNING 
        id,
        name,
        path,
        content,
        format,
        version,
        is_active,
        created_at,
        updated_at
    `;

    return results[0];
  }

  /**
   * Updates an existing config file and bumps version.
   */
  async update(
    tenantId: string,
    path: string,
    data: IUpdateConfigFileData,
  ): Promise<IConfigFile | null> {
    const sql = await this.getSql(tenantId);

    // Build dynamic update
    const updates: string[] = ["updated_at = NOW()", "version = version + 1"];

    if (data.name !== undefined) {
      appendSqlSetFragment(updates, sql`name = ${data.name}`);
    }
    if (data.content !== undefined) {
      appendSqlSetFragment(updates, sql`content = ${data.content}`);
    }
    if (data.is_active !== undefined) {
      appendSqlSetFragment(updates, sql`is_active = ${data.is_active}`);
    }

    const setClause = composeUpdateSetClause(updates);

    const results = await sql<IConfigFile[]>`
      UPDATE config_files
      SET ${sql.unsafe(setClause)}
      WHERE path = ${path} AND is_active = true
      RETURNING 
        id,
        name,
        path,
        content,
        format,
        version,
        is_active,
        created_at,
        updated_at
    `;

    return results[0] ?? null;
  }

  /**
   * Returns all active config files for deploy.
   */
  async findAllActive(tenantId: string): Promise<IConfigFile[]> {
    const sql = await this.getSql(tenantId);

    const files = await sql<IConfigFile[]>`
      SELECT 
        id,
        name,
        path,
        content,
        format,
        version,
        is_active,
        created_at,
        updated_at
      FROM config_files
      WHERE is_active = true
      ORDER BY path ASC
    `;

    return files;
  }
}
