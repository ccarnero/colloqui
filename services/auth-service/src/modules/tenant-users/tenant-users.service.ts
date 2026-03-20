import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { POSTGRES_SQL, type Sql } from "../../providers/postgres.provider";
import type { TenantUserRole } from "./tenant-user.dto";

export interface TenantUserRow {
  id: string;
  tenant_id: string;
  email: string;
  role: string;
  display_name: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

type TenantUserPublic = Omit<TenantUserRow, "is_active">;

@Injectable()
export class TenantUsersService {
  private readonly logger = new Logger(TenantUsersService.name);

  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  async create(
    tenantId: string,
    email: string,
    password: string,
    role: TenantUserRole,
    displayName?: string,
  ): Promise<TenantUserPublic> {
    const existing = await this.sql`
      SELECT id FROM tenant_users
      WHERE tenant_id = ${tenantId} AND email = ${email}
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new ConflictException(
        `User with email '${email}' already exists for this tenant`,
      );
    }

    const id = crypto.randomUUID();
    const passwordHash = await Bun.password.hash(password, {
      algorithm: "argon2id",
      memoryCost: 19_456,
      timeCost: 2,
    });

    const rows = await this.sql`
      INSERT INTO tenant_users (id, tenant_id, email, password_hash, role, display_name)
      VALUES (${id}, ${tenantId}, ${email}, ${passwordHash}, ${role}, ${displayName ?? null})
      RETURNING id, tenant_id, email, role, display_name, created_at, updated_at
    `;

    this.logger.log(
      `Created tenant user ${email} (role=${role}) for tenant ${tenantId}`,
    );
    return rows[0] as TenantUserPublic;
  }

  async listByTenant(tenantId: string): Promise<TenantUserPublic[]> {
    const rows = await this.sql`
      SELECT id, tenant_id, email, role, display_name, created_at, updated_at
      FROM tenant_users
      WHERE tenant_id = ${tenantId} AND is_active = true
      ORDER BY created_at DESC
    `;
    return rows as unknown as TenantUserPublic[];
  }

  async findById(id: string): Promise<TenantUserPublic> {
    const rows = await this.sql`
      SELECT id, tenant_id, email, role, display_name, created_at, updated_at
      FROM tenant_users
      WHERE id = ${id} AND is_active = true
      LIMIT 1
    `;
    if (rows.length === 0) {
      throw new NotFoundException("Tenant user not found");
    }
    return rows[0] as TenantUserPublic;
  }

  async update(
    id: string,
    updates: {
      role?: TenantUserRole;
      display_name?: string;
      is_active?: boolean;
    },
  ): Promise<TenantUserPublic> {
    const existing = await this.sql`
      SELECT id FROM tenant_users WHERE id = ${id} LIMIT 1
    `;
    if (existing.length === 0) {
      throw new NotFoundException("Tenant user not found");
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (updates.role !== undefined) {
      setClauses.push("role");
      values.push(updates.role);
    }
    if (updates.display_name !== undefined) {
      setClauses.push("display_name");
      values.push(updates.display_name);
    }
    if (updates.is_active !== undefined) {
      setClauses.push("is_active");
      values.push(updates.is_active);
    }

    const rows = await this.sql`
      UPDATE tenant_users SET
        role = COALESCE(${updates.role ?? null}, role),
        display_name = COALESCE(${updates.display_name ?? null}, display_name),
        is_active = COALESCE(${updates.is_active ?? null}, is_active),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, tenant_id, email, role, display_name, created_at, updated_at
    `;

    this.logger.log(`Updated tenant user ${id}`);
    return rows[0] as TenantUserPublic;
  }

  async deactivate(id: string): Promise<void> {
    const existing = await this.sql`
      SELECT id FROM tenant_users WHERE id = ${id} LIMIT 1
    `;
    if (existing.length === 0) {
      throw new NotFoundException("Tenant user not found");
    }

    await this.sql`
      UPDATE tenant_users SET is_active = false, updated_at = NOW()
      WHERE id = ${id}
    `;
    this.logger.log(`Deactivated tenant user ${id}`);
  }
}
