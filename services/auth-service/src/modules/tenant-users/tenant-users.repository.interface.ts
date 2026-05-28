export const TENANT_USERS_REPOSITORY = Symbol("TENANT_USERS_REPOSITORY");

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

export interface ITenantUserListRow {
  id: string;
  email: string;
  role_id: string;
  role: string;
  display_name: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ITenantUsersRepository {
  findByTenantAndEmail(
    tenantId: string,
    email: string,
  ): Promise<Array<{ id: string }>>;
  insertUser(
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
  >;
  selectRoleName(
    tenantId: string,
    roleId: string,
  ): Promise<Array<{ name: string }>>;
  listByTenant(tenantId: string): Promise<ITenantUserListRow[]>;
  findActiveById(
    tenantId: string,
    id: string,
  ): Promise<ITenantUserListRow[]>;
  findByIdAny(tenantId: string, id: string): Promise<Array<{ id: string }>>;
  updateUser(
    tenantId: string,
    id: string,
    roleId: string | null,
    displayName: string | null,
    isActive: boolean | null,
  ): Promise<void>;
  findId(tenantId: string, id: string): Promise<Array<{ id: string }>>;
  deactivate(tenantId: string, id: string): Promise<void>;
  resolveRoleById(
    roleIdOrName: string,
    tenantId: string,
  ): Promise<Array<{ id: string }>>;
  resolveRoleByName(
    roleIdOrName: string,
    tenantId: string,
  ): Promise<Array<{ id: string }>>;
}
