import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { POSTGRES_SQL, type Sql } from '../../providers/postgres.provider';
import { ARGON2_OPTIONS } from '../../utils/password';

export interface IClientRow {
  id: string;
  client_id: string;
  name: string;
  scope: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ICreatedClient extends IClientRow {
  client_secret: string;
}

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  async create(name: string, scope: string): Promise<ICreatedClient> {
    const id = crypto.randomUUID();
    const clientId = `yoizen_${crypto.randomUUID().replace(/-/g, '')}`;
    const clientSecret = `ysk_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;

    const secretHash = await Bun.password.hash(clientSecret, ARGON2_OPTIONS);

    const rows = await this.sql`
      INSERT INTO api_clients (id, client_id, client_secret_hash, name, scope)
      VALUES (${id}, ${clientId}, ${secretHash}, ${name}, ${scope})
      RETURNING id, client_id, name, scope, is_active, created_at, updated_at
    `;

    this.logger.log(`Created API client '${name}' with scope '${scope}'`);

    return {
      ...(rows[0] as IClientRow),
      client_secret: clientSecret,
    };
  }

  async list(tenantId?: string): Promise<Omit<IClientRow, 'is_active'>[]> {
    if (tenantId) {
      const tenantScope = `tenant:${tenantId}`;
      const rows = await this.sql`
        SELECT id, client_id, name, scope, created_at, updated_at
        FROM api_clients
        WHERE is_active = true
          AND (scope = 'platform' OR scope = ${tenantScope})
        ORDER BY created_at DESC
      `;
      return rows as unknown as Omit<IClientRow, 'is_active'>[];
    }

    const rows = await this.sql`
      SELECT id, client_id, name, scope, created_at, updated_at
      FROM api_clients
      WHERE is_active = true
      ORDER BY created_at DESC
    `;
    return rows as unknown as Omit<IClientRow, 'is_active'>[];
  }

  async revoke(id: string): Promise<void> {
    const result = await this.sql`
      UPDATE api_clients
      SET is_active = false, updated_at = NOW()
      WHERE id = ${id} AND is_active = true
      RETURNING id
    `;

    if (result.length === 0) {
      throw new NotFoundException(`Client '${id}' not found or already revoked`);
    }

    this.logger.log(`Revoked API client ${id}`);
  }
}
