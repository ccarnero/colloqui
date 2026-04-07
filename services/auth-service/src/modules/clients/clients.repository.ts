/** CRUD helpers for `api_clients`. */
import { Inject, Injectable } from "@nestjs/common";
import { POSTGRES_SQL, type Sql } from "../../providers/postgres.provider";

export interface IClientRow {
  id: string;
  client_id: string;
  name: string;
  scope: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Options for inserting an API client row. */
export interface IInsertClientOptions {
  id: string;
  clientId: string;
  secretHash: string;
  name: string;
  scope: string;
}

@Injectable()
export class ClientsRepository {
  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  async insertClient(options: IInsertClientOptions): Promise<IClientRow[]> {
    const { id, clientId, secretHash, name, scope } = options;
    const rows = await this.sql`
      INSERT INTO api_clients (id, client_id, client_secret_hash, name, scope)
      VALUES (${id}, ${clientId}, ${secretHash}, ${name}, ${scope})
      RETURNING id, client_id, name, scope, is_active, created_at, updated_at
    `;
    return rows as unknown as IClientRow[];
  }

  listForTenant(tenantScope: string): ReturnType<Sql> {
    return this.sql`
      SELECT id, client_id, name, scope, created_at, updated_at
      FROM api_clients
      WHERE is_active = true
        AND (scope = 'platform' OR scope = ${tenantScope})
      ORDER BY created_at DESC
    `;
  }

  listAllActive(): ReturnType<Sql> {
    return this.sql`
      SELECT id, client_id, name, scope, created_at, updated_at
      FROM api_clients
      WHERE is_active = true
      ORDER BY created_at DESC
    `;
  }

  async revokeClient(id: string): Promise<boolean> {
    const result = await this.sql`
      UPDATE api_clients
      SET is_active = false, updated_at = NOW()
      WHERE id = ${id} AND is_active = true
      RETURNING id
    `;
    return result.length > 0;
  }
}
