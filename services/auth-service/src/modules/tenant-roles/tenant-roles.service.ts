import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { SYSTEM_ROLE_TENANT_ADMIN } from "@yoizen/shared";
import type { PermissionDto } from "./tenant-role.dto";
import type {
  ITenantRoleSummary,
  ITenantRoleWithPermissions,
} from "./tenant-role.types";
import {
  TenantRolesRepository,
  type ITenantRoleRow,
} from "./tenant-roles.repository";

interface ICreateTenantRoleOptions {
  tenantId: string;
  name: string;
  description?: string;
  permissions: PermissionDto[];
}

/** Row shape from {@link TenantRolesRepository.findRoleForUpdate}. */
interface IRoleForUpdateRow {
  id: string;
  is_system: boolean;
  tenant_id: string;
  name: string;
}

@Injectable()
export class TenantRolesService {
  private readonly logger = new PinoLoggerService(TenantRolesService.name);

  constructor(private readonly tenantRolesRepository: TenantRolesRepository) {}

  /**
   * Idempotently seeds the tenant_admin system role for a tenant.
   * @returns The system role ID.
   */
  async seedSystemRole(tenantId: string): Promise<string> {
    const existing = await this.tenantRolesRepository.findSystemRoleId(tenantId);

    if (existing.length > 0) {
      return (existing[0] as { id: string }).id;
    }

    const id = crypto.randomUUID();
    await this.tenantRolesRepository.insertSystemRoleOnConflict(id, tenantId);

    this.logger.log(
      `Seeded system role '${SYSTEM_ROLE_TENANT_ADMIN}' for tenant ${tenantId}`,
    );
    return id;
  }

  async create(
    options: ICreateTenantRoleOptions,
  ): Promise<ITenantRoleWithPermissions> {
    const { tenantId, name, description, permissions } = options;
    if (name === SYSTEM_ROLE_TENANT_ADMIN) {
      throw new ConflictException(
        `Role name '${SYSTEM_ROLE_TENANT_ADMIN}' is reserved`,
      );
    }

    const existing = await this.tenantRolesRepository.findRoleByTenantAndName(
      tenantId,
      name,
    );
    if (existing.length > 0) {
      throw new ConflictException(
        `Role '${name}' already exists for this tenant`,
      );
    }

    const id = crypto.randomUUID();

    await this.tenantRolesRepository.createRoleWithPermissions({
      id,
      tenantId,
      name,
      description: description ?? null,
      permissions,
    });

    this.logger.log(
      `Created role '${name}' with ${permissions.length} permissions for tenant ${tenantId}`,
    );
    return this.getWithPermissions(id);
  }

  async listByTenant(tenantId: string): Promise<ITenantRoleSummary[]> {
    const rows = await this.tenantRolesRepository.listSummariesByTenant(
      tenantId,
    );
    return rows as unknown as ITenantRoleSummary[];
  }

  async getWithPermissions(id: string): Promise<ITenantRoleWithPermissions> {
    const rows = await this.tenantRolesRepository.findActiveRoleBase(id);

    if (rows.length === 0) {
      throw new NotFoundException("Role not found");
    }

    const role = rows[0] as ITenantRoleRow;
    const permRows =
      await this.tenantRolesRepository.listPermissionsForRole(id);

    return {
      ...role,
      permissions: permRows,
    };
  }

  async update(
    id: string,
    patch: {
      name?: string;
      description?: string;
      permissions?: PermissionDto[];
    },
  ): Promise<ITenantRoleWithPermissions> {
    const existing = await this.tenantRolesRepository.findRoleForUpdate(id);

    if (existing.length === 0) {
      throw new NotFoundException("Role not found");
    }

    const role = existing[0] as IRoleForUpdateRow;

    if (role.is_system && patch.name && patch.name !== role.name) {
      throw new ForbiddenException("Cannot rename a system role");
    }

    if (patch.name === SYSTEM_ROLE_TENANT_ADMIN && !role.is_system) {
      throw new ConflictException(
        `Role name '${SYSTEM_ROLE_TENANT_ADMIN}' is reserved`,
      );
    }

    if (patch.name) {
      const dup = await this.tenantRolesRepository.findDuplicateName(
        role.tenant_id,
        patch.name,
        id,
      );
      if (dup.length > 0) {
        throw new ConflictException(
          `Role '${patch.name}' already exists for this tenant`,
        );
      }
    }

    await this.tenantRolesRepository.updateRoleTransaction(id, patch);

    this.logger.log(`Updated role ${id}`);
    return this.getWithPermissions(id);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.tenantRolesRepository.findForDelete(id);

    if (existing.length === 0) {
      throw new NotFoundException("Role not found");
    }

    if ((existing[0] as { is_system?: boolean }).is_system) {
      throw new ForbiddenException("Cannot delete a system role");
    }

    const hasAssignedUsers =
      await this.tenantRolesRepository.hasActiveUsersForRole(id);

    if (hasAssignedUsers) {
      throw new BadRequestException(
        "Cannot delete a role that still has active users assigned",
      );
    }

    await this.tenantRolesRepository.softDeleteRole(id);

    this.logger.log(`Soft-deleted role ${id}`);
  }
}
