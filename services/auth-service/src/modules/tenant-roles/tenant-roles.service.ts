import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  POSTGRES_SQL,
  type Sql,
  type TxSql,
} from "../../providers/postgres.provider";
import { SYSTEM_ROLE_TENANT_ADMIN } from "@yoizen/shared";
import type { PermissionDto } from "./tenant-role.dto";

export interface TenantRoleRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface TenantRoleWithPermissions extends TenantRoleRow {
  permissions: Array<{ resource: string; action: string }>;
}

export interface TenantRoleSummary extends TenantRoleRow {
  user_count: number;
}

@Injectable()
export class TenantRolesService {
  private readonly logger = new Logger(TenantRolesService.name);

  constructor(@Inject(POSTGRES_SQL) private readonly sql: Sql) {}

  /**
   * Idempotently seeds the tenant_admin system role for a tenant.
   * @returns The system role ID.
   */
  async seedSystemRole(tenantId: string): Promise<string> {
    const existing = await this.sql`
      SELECT id FROM tenant_roles
      WHERE tenant_id = ${tenantId}
        AND name = ${SYSTEM_ROLE_TENANT_ADMIN}
      LIMIT 1
    `;

    if (existing.length > 0) {
      return existing[0].id as string;
    }

    const id = crypto.randomUUID();
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

    this.logger.log(
      `Seeded system role '${SYSTEM_ROLE_TENANT_ADMIN}' for tenant ${tenantId}`,
    );
    return id;
  }

  async getSystemRoleId(tenantId: string): Promise<string> {
    const rows = await this.sql`
      SELECT id FROM tenant_roles
      WHERE tenant_id = ${tenantId}
        AND name = ${SYSTEM_ROLE_TENANT_ADMIN}
        AND is_system = true
      LIMIT 1
    `;

    if (rows.length === 0) {
      return this.seedSystemRole(tenantId);
    }
    return rows[0].id as string;
  }

  async create(
    tenantId: string,
    name: string,
    description: string | undefined,
    permissions: PermissionDto[],
  ): Promise<TenantRoleWithPermissions> {
    if (name === SYSTEM_ROLE_TENANT_ADMIN) {
      throw new ConflictException(
        `Role name '${SYSTEM_ROLE_TENANT_ADMIN}' is reserved`,
      );
    }

    const existing = await this.sql`
      SELECT id FROM tenant_roles
      WHERE tenant_id = ${tenantId} AND name = ${name}
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new ConflictException(
        `Role '${name}' already exists for this tenant`,
      );
    }

    const id = crypto.randomUUID();

    await this.sql.begin(async (_tx) => {
      const tx = _tx as unknown as TxSql;
      await tx`
        INSERT INTO tenant_roles (id, tenant_id, name, description)
        VALUES (${id}, ${tenantId}, ${name}, ${description ?? null})
      `;

      for (const p of permissions) {
        const permId = crypto.randomUUID();
        await tx`
          INSERT INTO tenant_role_permissions (id, role_id, resource, action)
          VALUES (${permId}, ${id}, ${p.resource}, ${p.action})
        `;
      }
    });

    this.logger.log(
      `Created role '${name}' with ${permissions.length} permissions for tenant ${tenantId}`,
    );
    return this.getWithPermissions(id);
  }

  async listByTenant(tenantId: string): Promise<TenantRoleSummary[]> {
    const rows = await this.sql`
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
    return rows as unknown as TenantRoleSummary[];
  }

  async getWithPermissions(id: string): Promise<TenantRoleWithPermissions> {
    const rows = await this.sql`
      SELECT id, tenant_id, name, description,
             is_system, is_active, created_at, updated_at
      FROM tenant_roles
      WHERE id = ${id} AND is_active = true
      LIMIT 1
    `;

    if (rows.length === 0) {
      throw new NotFoundException("Role not found");
    }

    const role = rows[0] as unknown as TenantRoleRow;
    const permRows = await this.sql`
      SELECT resource, action
      FROM tenant_role_permissions
      WHERE role_id = ${id}
      ORDER BY resource, action
    `;

    return {
      ...role,
      permissions: permRows as unknown as Array<{
        resource: string;
        action: string;
      }>,
    };
  }

  async update(
    id: string,
    patch: {
      name?: string;
      description?: string;
      permissions?: PermissionDto[];
    },
  ): Promise<TenantRoleWithPermissions> {
    const existing = await this.sql`
      SELECT id, is_system, tenant_id, name
      FROM tenant_roles
      WHERE id = ${id} AND is_active = true
      LIMIT 1
    `;

    if (existing.length === 0) {
      throw new NotFoundException("Role not found");
    }

    const role = existing[0];

    if (role.is_system && patch.name && patch.name !== role.name) {
      throw new ForbiddenException("Cannot rename a system role");
    }

    if (patch.name === SYSTEM_ROLE_TENANT_ADMIN && !role.is_system) {
      throw new ConflictException(
        `Role name '${SYSTEM_ROLE_TENANT_ADMIN}' is reserved`,
      );
    }

    if (patch.name) {
      const dup = await this.sql`
        SELECT id FROM tenant_roles
        WHERE tenant_id = ${role.tenant_id}
          AND name = ${patch.name}
          AND id != ${id}
        LIMIT 1
      `;
      if (dup.length > 0) {
        throw new ConflictException(
          `Role '${patch.name}' already exists for this tenant`,
        );
      }
    }

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

    this.logger.log(`Updated role ${id}`);
    return this.getWithPermissions(id);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.sql`
      SELECT id, is_system FROM tenant_roles
      WHERE id = ${id} AND is_active = true
      LIMIT 1
    `;

    if (existing.length === 0) {
      throw new NotFoundException("Role not found");
    }

    if (existing[0].is_system) {
      throw new ForbiddenException("Cannot delete a system role");
    }

    const assigned = await this.sql`
      SELECT id FROM tenant_users
      WHERE role_id = ${id} AND is_active = true
      LIMIT 1
    `;

    if (assigned.length > 0) {
      throw new BadRequestException(
        "Cannot delete a role that still has active users assigned",
      );
    }

    await this.sql`
      UPDATE tenant_roles SET is_active = false, updated_at = NOW()
      WHERE id = ${id}
    `;

    this.logger.log(`Soft-deleted role ${id}`);
  }
}
