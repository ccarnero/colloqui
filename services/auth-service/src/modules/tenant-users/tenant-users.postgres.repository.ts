/** Tenant-scoped user accounts (`tenant_users`) in per-tenant Postgres. */
import { Inject, Injectable } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import { AuthTenantConnectionManager } from "../../providers/auth-tenant-connection-manager";
import type {
  IInsertTenantUserOptions,
  ITenantUserListRow,
  ITenantUsersRepository,
} from "./tenant-users.repository.interface";

@Injectable()
export class TenantUsersPostgresRepository implements ITenantUsersRepository {
  constructor(
    @Inject(AuthTenantConnectionManager)
    private readonly tenantSql: TenantConnectionManager,
  ) {}

  private async sqlFor(tenantId: string) {
    return this.tenantSql.ensureSchema(tenantId);
  }

  async findByTenantAndEmail(
    tenantId: string,
    email: string,
  ): Promise<Array<{ id: string }>> {
    const sql = await this.sqlFor(tenantId);
    return sql<Array<{ id: string }>>`
      SELECT id FROM tenant_users
      WHERE email = ${email}
      LIMIT 1
    `;
  }

  async insertUser(
    options: IInsertTenantUserOptions,
  ): Promise<
    Array<{
      id: string;
      email: string;
      role_id: string;
      display_name: string | null;
      created_at: Date;
      updated_at: Date;
    }>
  > {
    const { id, tenantId, email, passwordHash, roleId, displayName } = options;
    const sql = await this.sqlFor(tenantId);
    return sql<
      Array<{
        id: string;
        email: string;
        role_id: string;
        display_name: string | null;
        created_at: Date;
        updated_at: Date;
      }>
    >`
      INSERT INTO tenant_users (id, email, password_hash, role_id, display_name)
      VALUES (${id}, ${email}, ${passwordHash}, ${roleId}, ${displayName})
      RETURNING id, email, role_id, display_name, created_at, updated_at
    `;
  }

  async selectRoleName(
    tenantId: string,
    roleId: string,
  ): Promise<Array<{ name: string }>> {
    const sql = await this.sqlFor(tenantId);
    return sql<Array<{ name: string }>>`
      SELECT name FROM tenant_roles WHERE id = ${roleId} LIMIT 1
    `;
  }

  async listByTenant(tenantId: string): Promise<ITenantUserListRow[]> {
    const sql = await this.sqlFor(tenantId);
    return sql<ITenantUserListRow[]>`
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
  ): Promise<ITenantUserListRow[]> {
    const sql = await this.sqlFor(tenantId);
    return sql<ITenantUserListRow[]>`
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
  ): Promise<Array<{ id: string }>> {
    const sql = await this.sqlFor(tenantId);
    return sql<Array<{ id: string }>>`
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

  async findId(tenantId: string, id: string): Promise<Array<{ id: string }>> {
    const sql = await this.sqlFor(tenantId);
    return sql<Array<{ id: string }>>`
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
  ): Promise<Array<{ id: string }>> {
    const sql = await this.sqlFor(tenantId);
    return sql<Array<{ id: string }>>`
      SELECT id FROM tenant_roles
      WHERE id = ${roleIdOrName}
        AND is_active = true
      LIMIT 1
    `;
  }

  async resolveRoleByName(
    roleIdOrName: string,
    tenantId: string,
  ): Promise<Array<{ id: string }>> {
    const sql = await this.sqlFor(tenantId);
    return sql<Array<{ id: string }>>`
      SELECT id FROM tenant_roles
      WHERE name = ${roleIdOrName}
        AND is_active = true
      LIMIT 1
    `;
  }
}
