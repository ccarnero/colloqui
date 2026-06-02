import { Injectable } from "@nestjs/common";
import { TenantDatabaseTier, type TenantDatabaseTierValue } from "@yoizen/shared";
import { TenantPostgresProvisioner } from "./postgres.provider";
import { TenantUsagePostgresProvisioner } from "./postgres-usage.provider";
import type {
  ITenantProvisioner,
  ITenantProvisionRequest,
} from "./tenant-provisioner.interface";

/** Postgres OLTP + usage provisioning behind {@link ITenantProvisioner}. */
@Injectable()
export class TenantPostgresProvisionerAdapter implements ITenantProvisioner {
  constructor(
    private readonly oltpProvisioner: TenantPostgresProvisioner,
    private readonly usageProvisioner: TenantUsagePostgresProvisioner,
  ) {}

  async provision(input: string | ITenantProvisionRequest): Promise<void> {
    const request = this.normalize(input);
    await Promise.all([
      this.oltpProvisioner.provision(request),
      this.usageProvisioner.provisionUsage(request.namespace, request.tier),
    ]);
  }

  async waitForReady(
    namespace: string,
    tierOrTimeout?: TenantDatabaseTierValue | number,
    timeoutMs?: number,
  ): Promise<void> {
    await Promise.all([
      this.oltpProvisioner.waitForReady(namespace, tierOrTimeout, timeoutMs),
      this.usageProvisioner.waitForReady(namespace, tierOrTimeout, timeoutMs),
    ]);
  }

  async deprovisionShared(tenantId: string): Promise<void> {
    await this.oltpProvisioner.deprovisionShared(tenantId);
  }

  private normalize(input: string | ITenantProvisionRequest): ITenantProvisionRequest {
    if (typeof input !== "string") return input;
    return {
      namespace: input,
      tenantId: input,
      tier: TenantDatabaseTier.Dedicated,
    };
  }
}
