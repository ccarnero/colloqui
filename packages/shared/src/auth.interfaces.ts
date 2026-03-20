export type TokenScope = 'platform' | `tenant:${string}`;
export type TokenType = 'user' | 'client';
export type PlatformUserRole = 'admin' | 'operator';
export type TenantUserRole = 'tenant_admin' | 'tenant_editor' | 'tenant_viewer';
export type UserRole = PlatformUserRole | TenantUserRole;

export interface JwtPayload {
  sub: string;
  type: TokenType;
  scope: TokenScope;
  role?: UserRole;
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
