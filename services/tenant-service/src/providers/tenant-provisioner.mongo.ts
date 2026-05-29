import { Injectable } from "@nestjs/common";
import type { TenantDatabaseTierValue } from "@yoizen/shared";
import { TenantMongoProvisioner } from "./mongo.provider";
import type {
  ITenantProvisioner,
  ITenantProvisionRequest,
} from "./tenant-provisioner.interface";

/** Mongo provisioning behind {@link ITenantProvisioner}. */
@Injectable()
export class TenantMongoProvisionerAdapter implements ITenantProvisioner {
  constructor(private readonly mongoProvisioner: TenantMongoProvisioner) {}

  provision(input: string | ITenantProvisionRequest): Promise<void> {
    return this.mongoProvisioner.provision(input);
  }

  waitForReady(
    namespace: string,
    tierOrTimeout?: TenantDatabaseTierValue | number,
    timeoutMs?: number,
  ): Promise<void> {
    return this.mongoProvisioner.waitForReady(namespace, tierOrTimeout, timeoutMs);
  }

  deprovisionShared(tenantId: string): Promise<void> {
    return this.mongoProvisioner.deprovisionShared(tenantId);
  }
}
