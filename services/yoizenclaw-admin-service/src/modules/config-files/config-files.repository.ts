import { Injectable } from '@nestjs/common';
import { TenantConnectionManager, type Sql } from '../../providers/tenant-connection-manager';

export interface ConfigFile {
  id: string;
  name: string;
  path: string;
  content: string;
  format: 'yaml' | 'json';
  version: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateConfigFileData {
  name: string;
  path: string;
  content: string;
  format: 'yaml' | 'json';
}

export interface UpdateConfigFileData {
  name?: string;
  content?: string;
  is_active?: boolean;
}

export interface FindAllOptions {
  limit?: number;
  offset?: number;
}

@Injectable()
export class ConfigFilesRepository {
  constructor(
    private readonly connectionManager: TenantConnectionManager,
  ) {}

  private getSql(tenantId: string): Sql {
    return this.connectionManager.getConnection(tenantId);
  }

  /**
   * Lista todos los config files con paginación.
   */
  async findAll(
    tenantId: string,
    options: FindAllOptions = {},
  ): Promise<{ files: ConfigFile[]; total: number }> {
    const sql = this.getSql(tenantId);
    const { limit = 20, offset = 0 } = options;

    // Get total count
    const countResult = await sql<{ count: number }[]>`
      SELECT COUNT(*) as count FROM config_files WHERE is_active = true
    `;
    const total = Number(countResult[0].count);

    // Get files with pagination
    const files = await sql<ConfigFile[]>`
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
   * Busca un config file por su path único.
   */
  async findByPath(tenantId: string, path: string): Promise<ConfigFile | null> {
    const sql = this.getSql(tenantId);

    const results = await sql<ConfigFile[]>`
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
   * Crea un nuevo config file.
   */
  async create(
    tenantId: string,
    data: CreateConfigFileData,
  ): Promise<ConfigFile> {
    const sql = this.getSql(tenantId);

    const results = await sql<ConfigFile[]>`
      INSERT INTO config_files (
        name,
        path,
        content,
        format,
        version,
        is_active,
        created_at,
        updated_at
      ) VALUES (
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
   * Actualiza un config file existente e incrementa la versión.
   */
  async update(
    tenantId: string,
    path: string,
    data: UpdateConfigFileData,
  ): Promise<ConfigFile | null> {
    const sql = this.getSql(tenantId);

    // Build dynamic update
    const updates: string[] = ['updated_at = NOW()', 'version = version + 1'];

    if (data.name !== undefined) {
      updates.push(sql`name = ${data.name}` as unknown as string);
    }
    if (data.content !== undefined) {
      updates.push(sql`content = ${data.content}` as unknown as string);
    }
    if (data.is_active !== undefined) {
      updates.push(sql`is_active = ${data.is_active}` as unknown as string);
    }

    const setClause = updates.join(', ');

    const results = await sql<ConfigFile[]>`
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
   * Elimina (soft delete) un config file.
   */
  async delete(tenantId: string, path: string): Promise<boolean> {
    const sql = this.getSql(tenantId);

    const results = await sql<ConfigFile[]>`
      UPDATE config_files
      SET is_active = false, updated_at = NOW()
      WHERE path = ${path} AND is_active = true
      RETURNING id
    `;

    return results.length > 0;
  }

  /**
   * Obtiene todos los config files activos para deploy.
   */
  async findAllActive(tenantId: string): Promise<ConfigFile[]> {
    const sql = this.getSql(tenantId);

    const files = await sql<ConfigFile[]>`
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
