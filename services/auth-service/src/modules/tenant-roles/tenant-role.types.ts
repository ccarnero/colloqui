import type { ITenantRoleRow } from "./tenant-roles.repository.interface";

export type ITenantRoleWithPermissions = ITenantRoleRow & {
  tenant_id: string;
  permissions: Array<{ resource: string; action: string }>;
};

export type ITenantRoleSummary = ITenantRoleRow & {
  tenant_id: string;
  user_count: number;
};
