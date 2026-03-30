import { SetMetadata } from "@nestjs/common";

export const PERMISSIONS_KEY = "requiredPermissions";

/**
 * Requires the JWT to contain the specified permission(s).
 * Platform tokens and tenant_admin (permissions: ["*"]) bypass checks.
 */
export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
