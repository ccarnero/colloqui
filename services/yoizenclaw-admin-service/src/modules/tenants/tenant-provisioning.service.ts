import { Injectable } from "@nestjs/common";
import { TenantStreamManager } from "../../providers/tenant-stream-manager";
import { NatsAclManager } from "../../providers/nats-acl-manager";
import { StructuredLogger } from "../../logging/structured-logger";
import {
  type TenantTier,
  getTenantStreamName,
  getTenantSubjectPattern,
} from "../../types/stream-config";

export interface TenantProvisioningResult {
  success: boolean;
  streamCreated: boolean;
  aclsConfigured: boolean;
  errors: string[];
}

export interface TenantDeprovisioningResult {
  success: boolean;
  streamDeleted: boolean;
  aclsRemoved: boolean;
  errors: string[];
}

export interface TenantInfo {
  tenantId: string;
  tier: TenantTier;
  streamName: string;
  provisionedAt: string;
}

@Injectable()
export class TenantProvisioningService {
  private readonly logger = new StructuredLogger(
    TenantProvisioningService.name,
  );
  private readonly tenantRegistry = new Map<string, TenantInfo>();

  constructor(
    private readonly streamManager: TenantStreamManager,
    private readonly aclManager: NatsAclManager,
  ) {}

  async provisionTenant(
    tenantId: string,
    tier: TenantTier = "free",
  ): Promise<TenantProvisioningResult> {
    const errors: string[] = [];
    let streamCreated = false;
    let aclsConfigured = false;

    this.logger.info("provisioning", tenantId, "internal", `Provisioning tenant '${tenantId}' with tier '${tier}'`);

    try {
      const result = await this.streamManager.ensureTenantStream(
        tenantId,
        tier,
      );
      streamCreated = result.success;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Stream creation failed: ${message}`);
      this.logger.error("failed", tenantId, "internal", `Stream creation failed for tenant '${tenantId}'`, error);
    }

    try {
      const subjectPattern = getTenantSubjectPattern(tenantId);
      this.aclManager.configureTenantAcl(tenantId, [subjectPattern]);
      aclsConfigured = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`ACL configuration failed: ${message}`);
      this.logger.error("failed", tenantId, "internal", `ACL configuration failed for tenant '${tenantId}'`, error);
    }

    if (errors.length === 0) {
      const streamName = getTenantStreamName(tenantId);
      this.tenantRegistry.set(tenantId, {
        tenantId,
        tier,
        streamName,
        provisionedAt: new Date().toISOString(),
      });
      this.logger.info("completed", tenantId, "internal", `Tenant '${tenantId}' provisioned successfully`, {
        streamName,
        tier,
      });
    }

    return {
      success: errors.length === 0,
      streamCreated,
      aclsConfigured,
      errors,
    };
  }

  async deprovisionTenant(
    tenantId: string,
  ): Promise<TenantDeprovisioningResult> {
    const errors: string[] = [];
    let streamDeleted = false;
    let aclsRemoved = false;

    this.logger.info("deprovisioning", tenantId, "internal", `Deprovisioning tenant '${tenantId}'`);

    try {
      streamDeleted = await this.streamManager.deleteTenantStream(tenantId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Stream deletion failed: ${message}`);
      this.logger.error("failed", tenantId, "internal", `Stream deletion failed for tenant '${tenantId}'`, error);
    }

    try {
      this.aclManager.removeTenantAcl(tenantId);
      aclsRemoved = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`ACL removal failed: ${message}`);
      this.logger.error("failed", tenantId, "internal", `ACL removal failed for tenant '${tenantId}'`, error);
    }

    this.tenantRegistry.delete(tenantId);

    this.logger.info("completed", tenantId, "internal", `Tenant '${tenantId}' deprovisioned`, {
      streamDeleted,
      aclsRemoved,
    });

    return {
      success: errors.length === 0,
      streamDeleted,
      aclsRemoved,
      errors,
    };
  }

  getTenantInfo(tenantId: string): TenantInfo | undefined {
    return this.tenantRegistry.get(tenantId);
  }

  listTenants(): TenantInfo[] {
    return Array.from(this.tenantRegistry.values());
  }

  async updateTier(
    tenantId: string,
    newTier: TenantTier,
  ): Promise<boolean> {
    const existing = this.tenantRegistry.get(tenantId);
    if (!existing) return false;

    const result = await this.streamManager.verifyAndUpdateTier(
      tenantId,
      newTier,
    );
    if (!result.success) {
      this.logger.error("failed", tenantId, "internal", `Tier update failed for tenant '${tenantId}'`, result.error);
      return false;
    }

    this.tenantRegistry.set(tenantId, {
      ...existing,
      tier: newTier,
    });

    this.logger.info("completed", tenantId, "internal", `Tenant '${tenantId}' updated to tier '${newTier}'`);
    return true;
  }
}
