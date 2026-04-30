import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import {
  ensureDurableConsumer,
  NatsConsumerRunner,
  type INatsConsumerRunnerState,
} from "@yoizen/database";
import type { JetStreamClient, JetStreamManager } from "nats";
import {
  PLATFORM_TENANTS_STREAM_NAME,
  TENANT_PROVISION_REQUESTED_SUBJECT,
  TENANT_PROVISIONER_DURABLE,
  TENANT_PROVISION_MAX_DELIVER,
  type ITenantProvisionerState,
} from "@yoizen/shared";
import { JETSTREAM, JETSTREAM_MANAGER } from "../../providers/nats.module";
import { TenantProvisionHandler } from "./tenant-provision-handler.service";

const DURABLE = TENANT_PROVISIONER_DURABLE;
const STREAM = PLATFORM_TENANTS_STREAM_NAME;

/**
 * Pull consumer for `platform.tenant.provision.requested` (Workqueue stream).
 * Long-running handler: 5 min ack wait, bounded retries via `max_deliver`.
 *
 * The internal `NatsConsumerRunner` self-supervises its pull iterator
 * (auto-rebinds on connection drop / heartbeat miss / clean close), so
 * a dropped iterator no longer leaves the pod silently inert. We
 * surface the supervisor state via {@link getProvisionerState} so the
 * `/health` controller can return `degraded`/`stopped` and let
 * Knative liveness recycle the pod when the consumer is genuinely
 * unreachable.
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

  /**
   * Returns a coarse-grained state flag for `/health`. O(1) — only
   * reads cached primitive fields on the runner.
   *
   * Mapping:
   *  - `stopped`  : runner never started or has been torn down
   *  - `running`  : supervisor active AND iterator currently bound
   *  - `degraded` : supervisor active but in error-backoff between
   *                 reattach attempts (e.g. NATS server unreachable)
   */
  getProvisionerState(): ITenantProvisionerState {
    if (!this.runner) return "stopped";
    const state = this.runner.getState();
    if (!state.running) return "stopped";
    return state.isHealthy ? "running" : "degraded";
  }

  /** Raw runner snapshot for diagnostic endpoints / tests. */
  getRunnerState(): INatsConsumerRunnerState | null {
    return this.runner?.getState() ?? null;
  }
}
