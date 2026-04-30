import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import type { JetStreamClient } from "nats";
import { StringCodec } from "nats";
import {
  TENANT_PROVISION_REQUESTED_SUBJECT,
  type TenantProvisionRequestedMessageV1,
} from "@yoizen/shared";
import { JETSTREAM } from "./nats.module";
import type { TenantConfiguration } from "../modules/tenants/tenant.dto";

const sc = StringCodec();

@Injectable()
export class TenantProvisionPublisher {
  private readonly logger = new PinoLoggerService(
    TenantProvisionPublisher.name,
  );

  constructor(@Inject(JETSTREAM) private readonly js: JetStreamClient) {}

  /**
   * Enqueues async provisioning. JetStream `msgID` = tenantId for deduplication.
   * O(1) publish; network I/O only.
   */
  async publishProvisionRequested(params: {
    readonly tenantId: string;
    readonly name: string;
    readonly configuration: TenantConfiguration;
  }): Promise<void> {
    const body: TenantProvisionRequestedMessageV1 = {
      schemaVersion: 1,
      tenantId: params.tenantId,
      name: params.name,
      configuration: params.configuration,
    };
    const payload = sc.encode(JSON.stringify(body));
    try {
      await this.js.publish(TENANT_PROVISION_REQUESTED_SUBJECT, payload, {
        msgID: params.tenantId,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`NATS publish failed: ${msg}`);
      throw new ServiceUnavailableException(
        "Failed to enqueue tenant provisioning. Try again or contact the platform team.",
      );
    }
  }
}
