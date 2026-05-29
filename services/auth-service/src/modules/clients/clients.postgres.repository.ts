/** CRUD helpers for `api_clients` — PostgreSQL. */
import { Inject, Injectable } from "@nestjs/common";
import { POSTGRES_SQL, type Sql } from "@yoizen/database";
import type {
  IClientRow,
  IClientsRepository,
  IInsertClientOptions,
} from "./clients.repository.interface";

@Injectable()
export class ClientsPostgresRepository implements IClientsRepository {
  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  async insertClient(options: IInsertClientOptions): Promise<IClientRow[]> {
    const { id, clientId, secretHash, name, scope } = options;
    const rows = await this.sql<IClientRow[]>`
      INSERT INTO api_clients (id, client_id, client_secret_hash, name, scope)
      VALUES (${id}, ${clientId}, ${secretHash}, ${name}, ${scope})
      RETURNING id, client_id, name, scope, is_active, created_at, updated_at
    `;
    return rows;
  }

  async listForTenant(
    tenantScope: string,
  ): Promise<Omit<IClientRow, "is_active">[]> {
    const rows = await this.sql<Array<Omit<IClientRow, "is_active">>>`
      SELECT id, client_id, name, scope, created_at, updated_at
      FROM api_clients
      WHERE is_active = true
        AND (scope = 'platform' OR scope = ${tenantScope})
      ORDER BY created_at DESC
    `;
    return rows;
  }

  async listAllActive(): Promise<Omit<IClientRow, "is_active">[]> {
    const rows = await this.sql<Array<Omit<IClientRow, "is_active">>>`
      SELECT id, client_id, name, scope, created_at, updated_at
      FROM api_clients
      WHERE is_active = true
      ORDER BY created_at DESC
    `;
    return rows;
  }

  async revokeClient(id: string): Promise<boolean> {
    const result = await this.sql<Array<{ id: string }>>`
      UPDATE api_clients
      SET is_active = false, updated_at = NOW()
      WHERE id = ${id} AND is_active = true
      RETURNING id
    `;
    return result.length > 0;
  }
}
