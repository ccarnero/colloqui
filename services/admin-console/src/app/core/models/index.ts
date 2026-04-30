export type {
  IUser,
  ITenantRole,
  ITenantRolePermission,
} from "./user.model";
export type {
  IChannelAccount,
  IChannelAccountOption,
} from "./channel-account.model";
export type {
  IRegisteredService,
  IServiceDetail,
  ICreateService,
  IUpdateService,
  IServiceRoute,
  ICreateRoute,
} from "./registry.model";

export type { AdapterStatus } from "./adapter-status";

export interface IActivity {
  readonly color: string;
  readonly text: string;
  readonly time: string;
}
