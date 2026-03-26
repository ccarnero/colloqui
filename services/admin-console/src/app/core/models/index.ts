export type { ITenant } from "./tenant.model";
export type {
  IUser,
  ITenantRole,
  ITenantRolePermission,
} from "./user.model";

export interface IActivity {
  readonly color: string;
  readonly text: string;
  readonly time: string;
}
