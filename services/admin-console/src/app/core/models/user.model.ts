export interface IUser {
  id: string;
  tenant_id: string;
  email: string;
  role_id: string;
  role: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ITenantRolePermission {
  resource: string;
  action: string;
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
