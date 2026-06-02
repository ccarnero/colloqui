import type {
  ProvisioningStatusValue,
  TenantDatabaseTierValue,
} from "@yoizen/shared";
import type { ITenantRow, TenantConfiguration } from "./tenant.dto";

export const TENANTS_REPOSITORY = Symbol("TENANTS_REPOSITORY");

export interface ITenantsRepository {
  create(
    id: string,
    name: string,
    tier?: TenantDatabaseTierValue,
    configuration?: TenantConfiguration,
  ): Promise<ITenantRow>;
  findById(id: string): Promise<ITenantRow | undefined>;
  findByName(name: string): Promise<ITenantRow | undefined>;
  findAll(filter?: {
    status?: ProvisioningStatusValue;
  }): Promise<ITenantRow[]>;
  markProvisioningStarted(id: string): Promise<void>;
  markProvisioningReady(id: string): Promise<void>;
  markProvisioningFailed(id: string, err: string): Promise<void>;
  setProvisioningStatus(
    id: string,
    status: ProvisioningStatusValue,
    error: string | null,
  ): Promise<void>;
  updateConfiguration(
    name: string,
    configuration: TenantConfiguration,
  ): Promise<ITenantRow | undefined>;
  deleteByName(name: string): Promise<boolean>;
}
