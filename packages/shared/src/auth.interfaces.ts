export type TokenScope = 'platform' | `tenant:${string}`;
export type TokenType = 'user' | 'client';
export type UserRole = 'admin' | 'operator';

export interface JwtPayload {
  sub: string;
  type: TokenType;
  scope: TokenScope;
  role?: UserRole;
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
