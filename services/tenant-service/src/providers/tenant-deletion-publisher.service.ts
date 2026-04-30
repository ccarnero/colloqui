import { Inject, Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { NATS_CONNECTION } from "@yoizen/database";
import type { NatsConnection } from "nats";
import { StringCodec } from "nats";
import {
  TENANT_DELETED_SUBJECT,
  type TenantDatabaseTierValue,
  type TenantDeletedMessageV1,
} from "@yoizen/shared";

const sc = StringCodec();

/**
 * Best-effort fan-out publisher for `platform.tenant.deleted` over
 * **Core NATS** (NOT JetStream). Each long-lived service replica that
 * caches per-tenant Postgres pools subscribes and evicts; missed
 * messages (broker disconnect, replica restart) are recovered by the
 * self-healing branch in `TenantConnectionManager.verifyConnectivity`,
 * so we deliberately don't pay the durable-stream cost here.
 *
 * Why a separate class from {@link TenantProvisionPublisher}: that one
 * speaks JetStream (Workqueue retention, exactly-once-ish provisioning),
 * we need pub/sub fan-out — different transport, different failure
 * mode, different SLA.
 */
@Injectable()
export class TenantDeletionPublisher {
  private readonly logger = new PinoLoggerService(
    TenantDeletionPublisher.name,
  );

  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
  ) {}

  /**
   * Fire-and-forget publish. Errors are logged but never thrown — a
   * delete is already past the point of no return when this is called,
   * so failing the HTTP DELETE for a missed cache eviction would be a
   * worse user experience than a stale pool that self-heals on the
   * next probe.
   *
   * O(1); single Core NATS publish.
   */
  publishTenantDeleted(params: {
    readonly tenantId: string;
    readonly name: string;
    readonly tier?: TenantDatabaseTierValue;
  }): void {
    const body: TenantDeletedMessageV1 = {
      schemaVersion: 1,
      tenantId: params.tenantId,
      name: params.name,
      ...(params.tier !== undefined ? { tier: params.tier } : {}),
    };
    try {
      this.nc.publish(TENANT_DELETED_SUBJECT, sc.encode(JSON.stringify(body)));
      this.logger.log(
        `Published ${TENANT_DELETED_SUBJECT} for tenant '${params.name}' (id=${params.tenantId})`,
      );
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to publish ${TENANT_DELETED_SUBJECT} for tenant '${params.name}'; downstream pools will self-heal on next readiness probe: ${detail}`,
      );
    }
  }
}
