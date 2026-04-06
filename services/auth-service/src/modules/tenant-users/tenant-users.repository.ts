/** Tenant-scoped user accounts (`tenant_users`). */
import { Inject, Injectable } from "@nestjs/common";
import { POSTGRES_SQL, type Sql } from "../../providers/postgres.provider";

/** Options for inserting a tenant user row. */
export interface IInsertTenantUserOptions {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  roleId: string;
  displayName: string | null;
}

@Injectable()
export class TenantUsersRepository {
  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  findByTenantAndEmail(tenantId: string, email: string) {
    return this.sql`
      SELECT id FROM tenant_users
      WHERE tenant_id = ${tenantId} AND email = ${email}
      LIMIT 1
    `;
  }

  async insertUser(options: IInsertTenantUserOptions) {
    const { id, tenantId, email, passwordHash, roleId, displayName } = options;
    return this.sql`
      INSERT INTO tenant_users (id, tenant_id, email, password_hash, role_id, display_name)
      VALUES (${id}, ${tenantId}, ${email}, ${passwordHash}, ${roleId}, ${displayName})
      RETURNING id, tenant_id, email, role_id, display_name, created_at, updated_at
    `;
  }

  selectRoleName(roleId: string) {
    return this.sql`
      SELECT name FROM tenant_roles WHERE id = ${roleId} LIMIT 1
    `;
  }

  listByTenant(tenantId: string) {
    return this.sql`
      SELECT tu.id, tu.tenant_id, tu.email, tu.role_id,
             tr.name AS role, tu.display_name,
             tu.created_at, tu.updated_at
      FROM tenant_users tu
      JOIN tenant_roles tr ON tr.id = tu.role_id
      WHERE tu.tenant_id = ${tenantId} AND tu.is_active = true
      ORDER BY tu.created_at DESC
    `;
  }

  findActiveById(id: string) {
    return this.sql`
      SELECT tu.id, tu.tenant_id, tu.email, tu.role_id,
             tr.name AS role, tu.display_name,
             tu.created_at, tu.updated_at
      FROM tenant_users tu
      JOIN tenant_roles tr ON tr.id = tu.role_id
      WHERE tu.id = ${id} AND tu.is_active = true
      LIMIT 1
    `;
  }

  findByIdAny(id: string) {
    return this.sql`
      SELECT id, tenant_id FROM tenant_users WHERE id = ${id} LIMIT 1
    `;
  }

  async updateUser(
    id: string,
    roleId: string | null,
    displayName: string | null,
    isActive: boolean | null,
  ): Promise<void> {
    await this.sql`
      UPDATE tenant_users SET
        role_id = COALESCE(${roleId}, role_id),
        display_name = COALESCE(${displayName}, display_name),
        is_active = COALESCE(${isActive}, is_active),
        updated_at = NOW()
      WHERE id = ${id}
    `;
  }

  findId(id: string) {
    return this.sql`
      SELECT id FROM tenant_users WHERE id = ${id} LIMIT 1
    `;
  }

  async deactivate(id: string): Promise<void> {
    await this.sql`
      UPDATE tenant_users SET is_active = false, updated_at = NOW()
      WHERE id = ${id}
    `;
  }

  resolveRoleById(roleIdOrName: string, tenantId: string) {
    return this.sql`
      SELECT id FROM tenant_roles
      WHERE id = ${roleIdOrName}
        AND tenant_id = ${tenantId}
        AND is_active = true
      LIMIT 1
    `;
  }

  resolveRoleByName(roleIdOrName: string, tenantId: string) {
    return this.sql`
      SELECT id FROM tenant_roles
      WHERE name = ${roleIdOrName}
        AND tenant_id = ${tenantId}
        AND is_active = true
      LIMIT 1
    `;
  }
}
