import type { PermissionDto } from "./tenant-role.dto";

export const TENANT_ROLES_REPOSITORY = Symbol("TENANT_ROLES_REPOSITORY");

export interface ITenantRoleRow {
  id: string;
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
  /** Resolves pool only. */
  tenantId: string;
  name: string;
  description: string | null;
  permissions: PermissionDto[];
}

export interface ITenantRolesRepository {
  findSystemRoleId(tenantId: string): Promise<Array<{ id: string }>>;
  insertSystemRoleOnConflict(id: string, tenantId: string): Promise<void>;
  findRoleByTenantAndName(
    tenantId: string,
    name: string,
  ): Promise<Array<{ id: string }>>;
  createRoleWithPermissions(
    options: ICreateRoleWithPermissionsOptions,
  ): Promise<void>;
  listSummariesByTenant(
    tenantId: string,
  ): Promise<Array<ITenantRoleRow & { user_count: number }>>;
  findActiveRoleBase(tenantId: string, id: string): Promise<ITenantRoleRow[]>;
  listPermissionsForRole(
    tenantId: string,
    roleId: string,
  ): Promise<Array<{ resource: string; action: string }>>;
  findRoleForUpdate(
    tenantId: string,
    id: string,
  ): Promise<Array<{ id: string; is_system: boolean; name: string }>>;
  findDuplicateName(
    tenantId: string,
    name: string,
    excludeId: string,
  ): Promise<Array<{ id: string }>>;
  updateRoleTransaction(
    tenantId: string,
    id: string,
    patch: {
      name?: string;
      description?: string;
      permissions?: PermissionDto[];
    },
  ): Promise<void>;
  findForDelete(
    tenantId: string,
    id: string,
  ): Promise<Array<{ id: string; is_system: boolean }>>;
  hasActiveUsersForRole(tenantId: string, roleId: string): Promise<boolean>;
  softDeleteRole(tenantId: string, id: string): Promise<void>;
}
