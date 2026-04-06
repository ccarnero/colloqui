export {
  AUTH_CONTEXT,
  type IAuthContext,
} from "./auth-context";
export type {
  IJwtPayload,
  ITokenResponse,
  IUserProfile,
  LoginTenantMode,
} from "./auth-types";
export { SYSTEM_ROLE_TENANT_ADMIN } from "./auth-constants";
export {
  decodeJwtPayload,
  extractInitials,
  formatRole,
} from "./auth-utils";
export { BaseAuthService } from "./base-auth.service";
export { authInterceptor } from "./auth.interceptor";
export { tenantInterceptor } from "./tenant.interceptor";
export { authGuard } from "./auth.guard";
export { provideCoreApp } from "./app-providers";

/** Aliases for consumers that prefer PascalCase interceptor names. */
export { authInterceptor as AuthInterceptor } from "./auth.interceptor";
export { tenantInterceptor as TenantInterceptor } from "./tenant.interceptor";
