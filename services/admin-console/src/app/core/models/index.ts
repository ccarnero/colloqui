export type { ITenant } from "./tenant.model";
export type {
  IUser,
  ITenantRole,
  ITenantRolePermission,
} from "./user.model";
export type {
  IRegisteredService,
  IServiceDetail,
  ICreateService,
  IUpdateService,
  IServiceRoute,
  ICreateRoute,
} from "./registry.model";

export interface IActivity {
  readonly color: string;
  readonly text: string;
  readonly time: string;
}
