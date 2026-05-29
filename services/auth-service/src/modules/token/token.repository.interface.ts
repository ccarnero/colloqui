export const TOKEN_REPOSITORY = Symbol("TOKEN_REPOSITORY");

export interface ITokenRepository {
  findClientByClientId(clientId: string): Promise<
    Array<{
      id: string;
      client_secret_hash: string;
      scope: string;
      is_active: boolean;
    }>
  >;
  findPlatformUserById(userId: string): Promise<
    Array<{
      id: string;
      email: string;
      role: string;
      is_active: boolean;
    }>
  >;
  findTenantUserForRefresh(
    tenantId: string,
    userId: string,
  ): Promise<
    Array<{
      id: string;
      email: string;
      is_active: boolean;
      role_name: string;
      is_system: boolean;
    }>
  >;
  findPlatformUserByEmail(email: string): Promise<
    Array<{
      id: string;
      email: string;
      password_hash: string;
      role: string;
      is_active: boolean;
    }>
  >;
  findTenantUserWithTenant(
    email: string,
    tenantId: string,
  ): Promise<
    Array<{
      id: string;
      email: string;
      password_hash: string;
      role_name: string;
      is_system: boolean;
    }>
  >;
  findTenantUserByEmailAnyTenant(email: string): Promise<
    Array<{
      id: string;
      email: string;
      password_hash: string;
      role_name: string;
      is_system: boolean;
      tenant_id: string;
    }>
  >;
  resolvePermissionsForUser(
    tenantId: string,
    userId: string,
  ): Promise<Array<{ resource: string; action: string }>>;
}
