import { Inject, Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { NATS_CONNECTION } from "@yoizen/database";
import type { NatsConnection } from "nats";
import { StringCodec } from "nats";
import {
  TENANT_READY_SUBJECT,
  type TenantDatabaseTierValue,
  type TenantReadyMessageV1,
} from "@yoizen/shared";

const sc = StringCodec();

/**
 * Best-effort fan-out publisher for `platform.tenant.ready` over **Core
 * NATS** (NOT JetStream). Subscribers (e.g. scheduler-service) use the
 * event to **proactively** run per-tenant DDL / pre-warm pools the
 * moment a tenant becomes usable, instead of paying the DDL cost on
 * the first synchronous request.
 *
 * Mirrors {@link TenantDeletionPublisher} exactly:
 *  - Same transport (Core NATS, no JetStream durability).
 *  - Same SLA: a missed message just means the lazy
 *    `TenantConnectionManager.ensureSchema(tenantId)` path still works;
 *    the first request after creation pays the one-time DDL cost.
 *  - Fire-and-forget; never throw on publish failure (we hold no lock
 *    when this is called and have no way to roll back the DB UPDATE
 *    that flipped `provisioning_status` to `ready`).
 *
 * Why a separate class from {@link TenantProvisionPublisher}: that one
 * speaks JetStream (Workqueue, exactly-once-ish provisioning); this is
 * pub/sub fan-out. Different transport, different failure mode.
 */
@Injectable()
export class TenantReadyPublisher {
  private readonly logger = new PinoLoggerService(TenantReadyPublisher.name);

  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
  ) {}

  /**
   * O(1); single Core NATS publish.
   */
  publishTenantReady(params: {
    readonly tenantId: string;
    readonly name: string;
    readonly tier?: TenantDatabaseTierValue;
  }): void {
    const body: TenantReadyMessageV1 = {
      schemaVersion: 1,
      tenantId: params.tenantId,
      name: params.name,
      ...(params.tier !== undefined ? { tier: params.tier } : {}),
    };
    try {
      this.nc.publish(TENANT_READY_SUBJECT, sc.encode(JSON.stringify(body)));
      this.logger.log(
        `Published ${TENANT_READY_SUBJECT} for tenant '${params.name}' (id=${params.tenantId})`,
      );
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to publish ${TENANT_READY_SUBJECT} for tenant '${params.name}'; subscribers will fall back to lazy ensureSchema on first request: ${detail}`,
      );
    }
  }
}
