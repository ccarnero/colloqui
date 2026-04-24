import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import {
  ensureDurableConsumer,
  NatsConsumerRunner,
} from "@yoizen/database";
import type { JetStreamClient, JetStreamManager } from "nats";
import {
  PLATFORM_TENANTS_STREAM_NAME,
  TENANT_PROVISION_REQUESTED_SUBJECT,
  TENANT_PROVISIONER_DURABLE,
  TENANT_PROVISION_MAX_DELIVER,
} from "@yoizen/shared";
import { JETSTREAM, JETSTREAM_MANAGER } from "../../providers/nats.module";
import { TenantProvisionHandler } from "./tenant-provision-handler.service";

const DURABLE = TENANT_PROVISIONER_DURABLE;
const STREAM = PLATFORM_TENANTS_STREAM_NAME;

/**
 * Pull consumer for `platform.tenant.provision.requested` (Workqueue stream).
 * Long-running handler: 5 min ack wait, bounded retries via `max_deliver`.
 */
@Injectable()
export class TenantProvisionConsumerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new PinoLoggerService(
    TenantProvisionConsumerService.name,
  );
  private runner: NatsConsumerRunner | null = null;

  constructor(
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
    private readonly handler: TenantProvisionHandler,
  ) {}

  async onModuleInit(): Promise<void> {
    await ensureDurableConsumer(this.jsm, {
      stream: STREAM,
      durableName: DURABLE,
      filterSubject: TENANT_PROVISION_REQUESTED_SUBJECT,
      maxDeliver: TENANT_PROVISION_MAX_DELIVER,
      maxAckPending: 4,
      ackWaitMs: 300_000,
      description: "Tenant async provisioning — namespace + Postgres",
    });
    const consumer = await this.js.consumers.get(STREAM, DURABLE);
    this.runner = new NatsConsumerRunner(
      consumer,
      (m) => this.handler.handle(m),
      this.logger,
      { concurrency: 2, maxMessages: 15, expires: 60_000 },
      {},
      undefined,
      DURABLE,
    );
    await this.runner.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.runner?.stop();
  }
}
