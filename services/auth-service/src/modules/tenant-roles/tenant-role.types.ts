import type { ITenantRoleRow } from "./tenant-roles.repository";

export type ITenantRoleWithPermissions = ITenantRoleRow & {
  permissions: Array<{ resource: string; action: string }>;
};

export type ITenantRoleSummary = ITenantRoleRow & { user_count: number };
