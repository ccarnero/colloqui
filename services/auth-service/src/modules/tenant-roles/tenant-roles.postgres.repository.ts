/** Tenant roles and permission rows in per-tenant Postgres. */
import { Inject, Injectable } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import { AuthTenantConnectionManager } from "../../providers/auth-tenant-connection-manager";
import type { TxSql } from "../../providers/postgres.provider";
import { SYSTEM_ROLE_TENANT_ADMIN } from "@yoizen/shared";
import type { PermissionDto } from "./tenant-role.dto";
import type {
  ICreateRoleWithPermissionsOptions,
  ITenantRoleRow,
  ITenantRolesRepository,
} from "./tenant-roles.repository.interface";

@Injectable()
export class TenantRolesPostgresRepository implements ITenantRolesRepository {
  constructor(
    @Inject(AuthTenantConnectionManager)
    private readonly tenantSql: TenantConnectionManager,
  ) {}

  private async sqlFor(tenantId: string) {
    return this.tenantSql.ensureSchema(tenantId);
  }

  async findSystemRoleId(tenantId: string): Promise<Array<{ id: string }>> {
    const sql = await this.sqlFor(tenantId);
    return sql<Array<{ id: string }>>`
      SELECT id FROM tenant_roles
      WHERE name = ${SYSTEM_ROLE_TENANT_ADMIN}
      LIMIT 1
    `;
  }

  async insertSystemRoleOnConflict(
    id: string,
    tenantId: string,
  ): Promise<void> {
    const sql = await this.sqlFor(tenantId);
    await sql`
      INSERT INTO tenant_roles (id, name, description, is_system)
      VALUES (
        ${id},
        ${SYSTEM_ROLE_TENANT_ADMIN},
        ${"Full administrative access — bypasses all permission checks"},
        true
      )
      ON CONFLICT (name) DO NOTHING
    `;
  }

  async findRoleByTenantAndName(
    tenantId: string,
    name: string,
  ): Promise<Array<{ id: string }>> {
    const sql = await this.sqlFor(tenantId);
    return sql<Array<{ id: string }>>`
      SELECT id FROM tenant_roles
      WHERE name = ${name}
      LIMIT 1
    `;
  }

  async createRoleWithPermissions(
    options: ICreateRoleWithPermissionsOptions,
  ): Promise<void> {
    const { id, tenantId, name, description, permissions } = options;
    const sql = await this.sqlFor(tenantId);
    await sql.begin(async (_tx) => {
      const tx = _tx as unknown as TxSql;
      await tx`
        INSERT INTO tenant_roles (id, name, description)
        VALUES (${id}, ${name}, ${description})
      `;

      for (const p of permissions) {
        const permId = crypto.randomUUID();
        await tx`
          INSERT INTO tenant_role_permissions (id, role_id, resource, action)
          VALUES (${permId}, ${id}, ${p.resource}, ${p.action})
        `;
      }
    });
  }

  async listSummariesByTenant(
    tenantId: string,
  ): Promise<Array<ITenantRoleRow & { user_count: number }>> {
    const sql = await this.sqlFor(tenantId);
    const rows = await sql<Array<ITenantRoleRow & { user_count: number }>>`
      SELECT
        r.id, r.name, r.description,
        r.is_system, r.is_active, r.created_at, r.updated_at,
        COUNT(DISTINCT tu.id)::int AS user_count
      FROM tenant_roles r
      LEFT JOIN tenant_users tu
        ON tu.role_id = r.id AND tu.is_active = true
      WHERE r.is_active = true
      GROUP BY r.id
      ORDER BY r.is_system DESC, r.name ASC
    `;
    return rows;
  }

  async findActiveRoleBase(
    tenantId: string,
    id: string,
  ): Promise<ITenantRoleRow[]> {
    const sql = await this.sqlFor(tenantId);
    const rows = await sql<ITenantRoleRow[]>`
      SELECT id, name, description,
             is_system, is_active, created_at, updated_at
      FROM tenant_roles
      WHERE id = ${id} AND is_active = true
      LIMIT 1
    `;
    return rows;
  }

  async listPermissionsForRole(
    tenantId: string,
    roleId: string,
  ): Promise<Array<{ resource: string; action: string }>> {
    const sql = await this.sqlFor(tenantId);
    const rows = await sql<Array<{ resource: string; action: string }>>`
      SELECT resource, action
      FROM tenant_role_permissions
      WHERE role_id = ${roleId}
      ORDER BY resource, action
    `;
    return rows;
  }

  async findRoleForUpdate(
    tenantId: string,
    id: string,
  ): Promise<Array<{ id: string; is_system: boolean; name: string }>> {
    const sql = await this.sqlFor(tenantId);
    return sql<Array<{ id: string; is_system: boolean; name: string }>>`
      SELECT id, is_system, name
      FROM tenant_roles
      WHERE id = ${id} AND is_active = true
      LIMIT 1
    `;
  }

  async findDuplicateName(
    tenantId: string,
    name: string,
    excludeId: string,
  ): Promise<Array<{ id: string }>> {
    const sql = await this.sqlFor(tenantId);
    return sql<Array<{ id: string }>>`
      SELECT id FROM tenant_roles
      WHERE name = ${name}
        AND id != ${excludeId}
      LIMIT 1
    `;
  }

  async updateRoleTransaction(
    tenantId: string,
    id: string,
    patch: {
      name?: string;
      description?: string;
      permissions?: PermissionDto[];
    },
  ): Promise<void> {
    const sql = await this.sqlFor(tenantId);
    await sql.begin(async (_tx) => {
      const tx = _tx as unknown as TxSql;
      await tx`
        UPDATE tenant_roles SET
          name = COALESCE(${patch.name ?? null}, name),
          description = COALESCE(${patch.description ?? null}, description),
          updated_at = NOW()
        WHERE id = ${id}
      `;

      if (patch.permissions !== undefined) {
        await tx`DELETE FROM tenant_role_permissions WHERE role_id = ${id}`;

        for (const p of patch.permissions) {
          const permId = crypto.randomUUID();
          await tx`
            INSERT INTO tenant_role_permissions (id, role_id, resource, action)
            VALUES (${permId}, ${id}, ${p.resource}, ${p.action})
          `;
        }
      }
    });
  }

  async findForDelete(
    tenantId: string,
    id: string,
  ): Promise<Array<{ id: string; is_system: boolean }>> {
    const sql = await this.sqlFor(tenantId);
    return sql<Array<{ id: string; is_system: boolean }>>`
      SELECT id, is_system FROM tenant_roles
      WHERE id = ${id} AND is_active = true
      LIMIT 1
    `;
  }

  async hasActiveUsersForRole(
    tenantId: string,
    roleId: string,
  ): Promise<boolean> {
    const sql = await this.sqlFor(tenantId);
    const rows = await sql<Array<{ id: string }>>`
      SELECT id FROM tenant_users
      WHERE role_id = ${roleId} AND is_active = true
      LIMIT 1
    `;
    return rows.length > 0;
  }

  async softDeleteRole(tenantId: string, id: string): Promise<void> {
    const sql = await this.sqlFor(tenantId);
    await sql`
      UPDATE tenant_roles SET is_active = false, updated_at = NOW()
      WHERE id = ${id}
    `;
  }
}
