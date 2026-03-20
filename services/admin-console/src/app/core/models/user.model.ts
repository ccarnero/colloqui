export type TenantUserRole =
  | "tenant_admin"
  | "tenant_editor"
  | "tenant_viewer";

export interface IUser {
  id: string;
  tenant_id: string;
  email: string;
  role: TenantUserRole;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}
