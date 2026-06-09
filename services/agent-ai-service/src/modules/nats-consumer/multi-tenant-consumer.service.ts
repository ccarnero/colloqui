import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { JetStreamClient, JetStreamManager, JsMsg } from "nats";
import {
  MultiTenantConsumerManager,
  type IMultiTenantConsumerConfig,
} from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import { JETSTREAM, JETSTREAM_MANAGER } from "../../providers/nats.provider";
import { MessageRouterService } from "./message-router.service";

const DURABLE_NAME = "agent-ai-service-consumer";
const TENANT_STREAM_PATTERN = /^INGRESS-/;
const FILTER_SUBJECTS = [
  "evt.*.agent-admin-service.automation.platform.internal.config_sync.v1",
  "evt.*.agent-admin-service.automation.platform.internal.jobs_sync.v1",
  "evt.*.agent-admin-service.automation.platform.internal.job_trigger.v1",
  "evt.*.agent-admin-service.automation.platform.internal.chat_respond.v1",
  "evt.*.agent-admin-service.automation.platform.internal.agent_outbound.v1",
  "evt.*.agent-admin-service.automation.platform.internal.agent_published.v1",
  "evt.*.agent-admin-service.automation.platform.internal.agent_unpublished.v1",
  "evt.*.agent-admin-service.automation.platform.internal.skill_changed.v1",
  "evt.*.ai-agent-gateway.automation.platform.internal.execution_requested.v1",
] as const;

@Injectable()
export class MultiTenantConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(MultiTenantConsumerService.name);
  private manager: MultiTenantConsumerManager | null = null;

  constructor(
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
    private readonly messageRouter: MessageRouterService,
  ) {}

  async onModuleInit(): Promise<void> {
    const config: IMultiTenantConsumerConfig = {
      streamPattern: TENANT_STREAM_PATTERN,
      durableName: DURABLE_NAME,
      filterSubjects: [...FILTER_SUBJECTS],
      description: "Agent AI service multi-tenant event consumer",
    };

    this.manager = new MultiTenantConsumerManager(
      this.jsm,
      this.js,
      config,
      (msg: JsMsg) => this.handleMessage(msg),
      this.logger,
    );

    await this.manager.start();
    this.logger.log("MultiTenantConsumerManager started");
  }

  async onModuleDestroy(): Promise<void> {
    if (this.manager) {
      await this.manager.stop();
      this.manager = null;
    }
  }

  private async handleMessage(msg: JsMsg): Promise<void> {
    await this.messageRouter.route(msg);
  }
}
