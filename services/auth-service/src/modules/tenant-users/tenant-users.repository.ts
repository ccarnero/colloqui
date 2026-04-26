/** Tenant-scoped user accounts (`tenant_users`) in per-tenant Postgres. */
import { Inject, Injectable } from "@nestjs/common";
import { AuthTenantConnectionManager } from "../../providers/auth-tenant-connection-manager";

/** Options for inserting a tenant user row. */
export interface IInsertTenantUserOptions {
  id: string;
  /** Resolves pool only. */
  tenantId: string;
  email: string;
  passwordHash: string;
  roleId: string;
  displayName: string | null;
}

@Injectable()
export class TenantUsersRepository {
  constructor(
    @Inject(AuthTenantConnectionManager)
    private readonly tenantSql: AuthTenantConnectionManager,
  ) {}

  private async sqlFor(tenantId: string) {
    return this.tenantSql.ensureSchema(tenantId);
  }

  async findByTenantAndEmail(
    tenantId: string,
    email: string,
  ): Promise<readonly unknown[]> {
    const sql = await this.sqlFor(tenantId);
    return sql`
      SELECT id FROM tenant_users
      WHERE email = ${email}
      LIMIT 1
    `;
  }

  async insertUser(
    options: IInsertTenantUserOptions,
  ): Promise<readonly unknown[]> {
    const { id, tenantId, email, passwordHash, roleId, displayName } = options;
    const sql = await this.sqlFor(tenantId);
    return sql`
      INSERT INTO tenant_users (id, email, password_hash, role_id, display_name)
      VALUES (${id}, ${email}, ${passwordHash}, ${roleId}, ${displayName})
      RETURNING id, email, role_id, display_name, created_at, updated_at
    `;
  }

  async selectRoleName(
    tenantId: string,
    roleId: string,
  ): Promise<readonly unknown[]> {
    const sql = await this.sqlFor(tenantId);
    return sql`
      SELECT name FROM tenant_roles WHERE id = ${roleId} LIMIT 1
    `;
  }

  async listByTenant(tenantId: string): Promise<readonly unknown[]> {
    const sql = await this.sqlFor(tenantId);
    return sql`
      SELECT tu.id, tu.email, tu.role_id,
             tr.name AS role, tu.display_name,
             tu.created_at, tu.updated_at
      FROM tenant_users tu
      JOIN tenant_roles tr ON tr.id = tu.role_id
      WHERE tu.is_active = true
      ORDER BY tu.created_at DESC
    `;
  }

  async findActiveById(
    tenantId: string,
    id: string,
  ): Promise<readonly unknown[]> {
    const sql = await this.sqlFor(tenantId);
    return sql`
      SELECT tu.id, tu.email, tu.role_id,
             tr.name AS role, tu.display_name,
             tu.created_at, tu.updated_at
      FROM tenant_users tu
      JOIN tenant_roles tr ON tr.id = tu.role_id
      WHERE tu.id = ${id} AND tu.is_active = true
      LIMIT 1
    `;
  }

  async findByIdAny(
    tenantId: string,
    id: string,
  ): Promise<readonly unknown[]> {
    const sql = await this.sqlFor(tenantId);
    return sql`
      SELECT id FROM tenant_users WHERE id = ${id} LIMIT 1
    `;
  }

  async updateUser(
    tenantId: string,
    id: string,
    roleId: string | null,
    displayName: string | null,
    isActive: boolean | null,
  ): Promise<void> {
    const sql = await this.sqlFor(tenantId);
    await sql`
      UPDATE tenant_users SET
        role_id = COALESCE(${roleId}, role_id),
        display_name = COALESCE(${displayName}, display_name),
        is_active = COALESCE(${isActive}, is_active),
        updated_at = NOW()
      WHERE id = ${id}
    `;
  }

  async findId(tenantId: string, id: string): Promise<readonly unknown[]> {
    const sql = await this.sqlFor(tenantId);
    return sql`
      SELECT id FROM tenant_users WHERE id = ${id} LIMIT 1
    `;
  }

  async deactivate(tenantId: string, id: string): Promise<void> {
    const sql = await this.sqlFor(tenantId);
    await sql`
      UPDATE tenant_users SET is_active = false, updated_at = NOW()
      WHERE id = ${id}
    `;
  }

  async resolveRoleById(
    roleIdOrName: string,
    tenantId: string,
  ): Promise<readonly unknown[]> {
    const sql = await this.sqlFor(tenantId);
    return sql`
      SELECT id FROM tenant_roles
      WHERE id = ${roleIdOrName}
        AND is_active = true
      LIMIT 1
    `;
  }

  async resolveRoleByName(
    roleIdOrName: string,
    tenantId: string,
  ): Promise<readonly unknown[]> {
    const sql = await this.sqlFor(tenantId);
    return sql`
      SELECT id FROM tenant_roles
      WHERE name = ${roleIdOrName}
        AND is_active = true
      LIMIT 1
    `;
  }
}
