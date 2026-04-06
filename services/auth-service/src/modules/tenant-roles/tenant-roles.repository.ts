/** Tenant roles and permission rows with transactional updates. */
import { Inject, Injectable } from "@nestjs/common";
import {
  POSTGRES_SQL,
  type Sql,
  type TxSql,
} from "../../providers/postgres.provider";
import { SYSTEM_ROLE_TENANT_ADMIN } from "@yoizen/shared";
import type { PermissionDto } from "./tenant-role.dto";

export interface ITenantRoleRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Options for creating a role with permission rows. */
export interface ICreateRoleWithPermissionsOptions {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  permissions: PermissionDto[];
}

@Injectable()
export class TenantRolesRepository {
  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  findSystemRoleId(tenantId: string) {
    return this.sql`
      SELECT id FROM tenant_roles
      WHERE tenant_id = ${tenantId}
        AND name = ${SYSTEM_ROLE_TENANT_ADMIN}
      LIMIT 1
    `;
  }

  async insertSystemRoleOnConflict(
    id: string,
    tenantId: string,
  ): Promise<void> {
    await this.sql`
      INSERT INTO tenant_roles (id, tenant_id, name, description, is_system)
      VALUES (
        ${id},
        ${tenantId},
        ${SYSTEM_ROLE_TENANT_ADMIN},
        ${"Full administrative access — bypasses all permission checks"},
        true
      )
      ON CONFLICT (tenant_id, name) DO NOTHING
    `;
  }

  findRoleByTenantAndName(tenantId: string, name: string) {
    return this.sql`
      SELECT id FROM tenant_roles
      WHERE tenant_id = ${tenantId} AND name = ${name}
      LIMIT 1
    `;
  }

  async createRoleWithPermissions(
    options: ICreateRoleWithPermissionsOptions,
  ): Promise<void> {
    const { id, tenantId, name, description, permissions } = options;
    await this.sql.begin(async (_tx) => {
      const tx = _tx as unknown as TxSql;
      await tx`
        INSERT INTO tenant_roles (id, tenant_id, name, description)
        VALUES (${id}, ${tenantId}, ${name}, ${description})
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

  listSummariesByTenant(tenantId: string) {
    return this.sql`
      SELECT
        r.id, r.tenant_id, r.name, r.description,
        r.is_system, r.is_active, r.created_at, r.updated_at,
        COUNT(DISTINCT tu.id)::int AS user_count
      FROM tenant_roles r
      LEFT JOIN tenant_users tu
        ON tu.role_id = r.id AND tu.is_active = true
      WHERE r.tenant_id = ${tenantId} AND r.is_active = true
      GROUP BY r.id
      ORDER BY r.is_system DESC, r.name ASC
    `;
  }

  findActiveRoleBase(id: string) {
    return this.sql`
      SELECT id, tenant_id, name, description,
             is_system, is_active, created_at, updated_at
      FROM tenant_roles
      WHERE id = ${id} AND is_active = true
      LIMIT 1
    `;
  }

  async listPermissionsForRole(
    roleId: string,
  ): Promise<Array<{ resource: string; action: string }>> {
    const rows = await this.sql`
      SELECT resource, action
      FROM tenant_role_permissions
      WHERE role_id = ${roleId}
      ORDER BY resource, action
    `;
    return rows as unknown as Array<{ resource: string; action: string }>;
  }

  findRoleForUpdate(id: string) {
    return this.sql`
      SELECT id, is_system, tenant_id, name
      FROM tenant_roles
      WHERE id = ${id} AND is_active = true
      LIMIT 1
    `;
  }

  findDuplicateName(tenantId: string, name: string, excludeId: string) {
    return this.sql`
      SELECT id FROM tenant_roles
      WHERE tenant_id = ${tenantId}
        AND name = ${name}
        AND id != ${excludeId}
      LIMIT 1
    `;
  }

  async updateRoleTransaction(
    id: string,
    patch: {
      name?: string;
      description?: string;
      permissions?: PermissionDto[];
    },
  ): Promise<void> {
    await this.sql.begin(async (_tx) => {
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

  findForDelete(id: string) {
    return this.sql`
      SELECT id, is_system FROM tenant_roles
      WHERE id = ${id} AND is_active = true
      LIMIT 1
    `;
  }

  /**
   * Returns whether any active tenant user is still assigned to this role.
   */
  async hasActiveUsersForRole(roleId: string): Promise<boolean> {
    const rows = await this.sql`
      SELECT id FROM tenant_users
      WHERE role_id = ${roleId} AND is_active = true
      LIMIT 1
    `;
    return rows.length > 0;
  }

  async softDeleteRole(id: string): Promise<void> {
    await this.sql`
      UPDATE tenant_roles SET is_active = false, updated_at = NOW()
      WHERE id = ${id}
    `;
  }
}
