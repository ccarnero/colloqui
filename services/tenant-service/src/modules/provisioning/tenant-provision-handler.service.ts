import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import {
  isTenantProvisionRequestedMessageV1,
  PermanentError,
  ProvisioningStatus,
  TENANT_PROVISION_MAX_DELIVER,
} from "@yoizen/shared";
import type { JsMsg } from "nats";
import { TenantsRepository } from "../tenants/tenants.repository";
import { TenantReadyPublisher } from "../../providers/tenant-ready-publisher.service";
import { TenantProvisioningExecutor } from "./tenant-provisioning-executor.service";

@Injectable()
export class TenantProvisionHandler {
  private readonly logger = new PinoLoggerService(TenantProvisionHandler.name);

  constructor(
    private readonly repository: TenantsRepository,
    private readonly executor: TenantProvisioningExecutor,
    private readonly readyPublisher: TenantReadyPublisher,
  ) {}

  /**
   * JetStream at-least-once: idempotency for `ready` and `failed` terminal states.
   * Transient throws → NAK; last delivery or poison → `failed` + term.
   */
  async handle(msg: JsMsg): Promise<void> {
    const text = new TextDecoder().decode(msg.data);
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      throw new PermanentError("Invalid JSON in provision message", "parse");
    }

    if (!isTenantProvisionRequestedMessageV1(json)) {
      throw new PermanentError(
        "Invalid TenantProvisionRequested message shape",
        "validate",
      );
    }
    const { tenantId, name, configuration } = json;
    const deliveryCount = msg.info.deliveryCount ?? 1;

    const row = await this.repository.findById(tenantId);
    if (!row) {
      throw new PermanentError(
        `No tenant row for id ${tenantId} (may have been deleted)`,
        "lookup",
      );
    }
    if (row.name !== name) {
      throw new PermanentError(
        "Tenant name mismatch for provision message",
        "validate",
      );
    }

    if (row.provisioning_status === ProvisioningStatus.Ready) {
      this.logger.log(`Tenant ${tenantId} already ready, ack duplicate`);
      return;
    }
    if (row.provisioning_status === ProvisioningStatus.Failed) {
      this.logger.warn(
        `Tenant ${tenantId} already failed, ack to drop redelivery`,
      );
      return;
    }

    try {
      await this.repository.markProvisioningStarted(tenantId);
      await this.executor.run({ name, tier: row.tier, configuration });
      await this.repository.markProvisioningReady(tenantId);
      // Best-effort fan-out so subscribers (e.g. scheduler-service) can
      // run per-tenant DDL eagerly and avoid the lazy first-request
      // penalty. Publish AFTER the DB UPDATE so subscribers only see
      // tenants whose `provisioning_status` is actually 'ready' if they
      // double-check via tenant-service. Failure is non-fatal — the
      // publisher already swallows + logs.
      this.readyPublisher.publishTenantReady({
        tenantId: row.id,
        name: row.name,
        tier: row.tier,
      });
    } catch (err: unknown) {
      if (err instanceof PermanentError) {
        throw err;
      }
      if (deliveryCount >= TENANT_PROVISION_MAX_DELIVER) {
        const reason =
          err instanceof Error
            ? err.message
            : `provisioning failed: ${String(err)}`;
        await this.repository.markProvisioningFailed(tenantId, reason);
        this.logger.error(
          `Marking tenant ${tenantId} failed after ${deliveryCount} deliveries: ${reason}`,
        );
        throw new PermanentError(
          `Provisioning exhausted retries: ${reason}`,
          "provision",
        );
      }
      this.logger.warn(
        `Provision attempt ${deliveryCount}/${TENANT_PROVISION_MAX_DELIVER} for ${tenantId} will retry: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}
