import { InjectionToken } from "@angular/core";

/**
 * Minimal auth surface for interceptors and guards. Apps provide this via
 * `{ provide: AUTH_CONTEXT, useExisting: AuthService }`.
 */
export interface IAuthContext {
  token(): string | null;
  tenantId(): string | null;
  isAuthenticated(): boolean;
}

export const AUTH_CONTEXT = new InjectionToken<IAuthContext>("AUTH_CONTEXT");
