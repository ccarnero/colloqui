/**
 * OAuth-style token response from `/auth/login` and `/auth/refresh`.
 */
export interface ITokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}

/**
 * Decoded JWT payload fields used by the consoles.
 */
export interface IJwtPayload {
  sub: string;
  type: string;
  scope: string;
  role?: string;
  permissions?: string[];
  tenant_id?: string;
  email?: string;
  env: string;
  iat: number;
  exp: number;
}

/**
 * UI-facing user profile derived from the JWT.
 */
export interface IUserProfile {
  id: string;
  name: string;
  email: string;
  initials: string;
  role: string;
}

/** How to send optional tenant id on login (backend contract differs per app). */
export type LoginTenantMode = "body" | "header";
