import type { TenantDatabaseTierValue } from "@yoizen/shared";

export const TENANT_PROVISIONER = Symbol("TENANT_PROVISIONER");

export interface ITenantProvisionRequest {
  readonly namespace: string;
  readonly tenantId: string;
  readonly tier: TenantDatabaseTierValue;
}

/** K8s database provisioning adapter selected by storage engine. */
export interface ITenantProvisioner {
  provision(input: string | ITenantProvisionRequest): Promise<void>;
  waitForReady(
    namespace: string,
    tierOrTimeout?: TenantDatabaseTierValue | number,
    timeoutMs?: number,
  ): Promise<void>;
  deprovisionShared(tenantId: string): Promise<void>;
}
