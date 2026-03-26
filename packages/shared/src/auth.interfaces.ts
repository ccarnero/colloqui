export type TokenScope = 'platform' | `tenant:${string}`;
export type TokenType = 'user' | 'client';
export type PlatformUserRole = 'admin' | 'operator';
export type TenantUserRole = string;
export type UserRole = PlatformUserRole | TenantUserRole;

export const SYSTEM_ROLE_TENANT_ADMIN = 'tenant_admin';

export interface JwtPayload {
  sub: string;
  type: TokenType;
  scope: TokenScope;
  role?: UserRole;
  permissions?: string[];
  tenant_id?: string;
  email?: string;
  env: string;
  iat: number;
  exp: number;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: TokenScope;
  refresh_token?: string;
}

export interface PublicRouteEntry {
  method: string;
  path: string;
  scope: TokenScope;
}

export interface ITenantRole {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  permissions?: ITenantRolePermission[];
  user_count?: number;
}

export interface ITenantRolePermission {
  resource: string;
  action: string;
}
