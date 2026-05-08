import {
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import type { Observable } from "rxjs";
import { map } from "rxjs";
import type { JetStreamClient, JetStreamManager, JsMsg } from "nats";
import type Redis from "ioredis";
import {
  MultiTenantConsumerManager,
  REDIS_CLIENT,
  ensureTenantIngressStream,
  type IMultiTenantConsumerConfig,
} from "@yoizen/database";
import {
  TENANT_HEADER,
  YoizenClawExecutionClient,
  YOIZENCLAW_EXECUTION_COMPLETED,
  YOIZENCLAW_EXECUTION_FAILED,
  YOIZENCLAW_EXECUTION_STARTED,
  type YoizenClawChatExecutionInput,
  type YoizenClawExecutionStatus,
} from "@yoizen/shared";
import { PinoLoggerService } from "@yoizen/observability";
import { createNatsMultiSubjectObservable } from "../../utils/nats-stream-observable.util";
import { JETSTREAM, JETSTREAM_MANAGER, NATS_CONNECTION } from "../../providers/nats.provider";
import type { NatsConnection } from "nats";

const DURABLE_NAME = "yoizenclaw-runtime-gateway-results";
const TENANT_STREAM_PATTERN = /^INGRESS-/;
const RESULT_SUBJECTS = [
  "evt.*.yoizenclaw-runtime-gateway.automation.yoizenclaw.internal.execution_started.v1",
  "evt.*.yoizenclaw-runtime-gateway.automation.yoizenclaw.internal.execution_completed.v1",
  "evt.*.yoizenclaw-runtime-gateway.automation.yoizenclaw.internal.execution_failed.v1",
] as const;

@Injectable()
export class ExecutionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new PinoLoggerService(ExecutionsService.name);
  private readonly client: YoizenClawExecutionClient;
  private manager: MultiTenantConsumerManager | null = null;

  constructor(
    @Inject(JETSTREAM) js: JetStreamClient,
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    @Inject(REDIS_CLIENT) redis: Redis,
  ) {
    this.client = new YoizenClawExecutionClient({
      nc,
      js,
      cache: redis,
      serviceName: "yoizenclaw-runtime-gateway",
    });
  }

  async onModuleInit(): Promise<void> {
    const config: IMultiTenantConsumerConfig = {
      streamPattern: TENANT_STREAM_PATTERN,
      durableName: DURABLE_NAME,
      filterSubjects: RESULT_SUBJECTS,
      description: "YoizenClaw runtime gateway execution result projector",
    };
    this.manager = new MultiTenantConsumerManager(
      this.jsm,
      this.nc.jetstream(),
      config,
      (msg: JsMsg) => this.handleResultMessage(msg),
      this.logger,
    );
    await this.manager.start();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.manager) {
      await this.manager.stop();
      this.manager = null;
    }
  }

  async submitExecution(
    tenantId: string,
    input: YoizenClawChatExecutionInput,
    requestedBy?: string,
  ): Promise<{ executionId: string; status: string }> {
    await ensureTenantIngressStream(this.jsm, tenantId);
    return this.client.submitExecution(tenantId, input, {
      requestedBy,
      correlationId: input.conversationId,
    });
  }

  async getExecution(
    tenantId: string,
    executionId: string,
  ): Promise<YoizenClawExecutionStatus> {
    const status = await this.client.getExecutionResult(tenantId, executionId);
    if (!status) {
      throw new NotFoundException(`Execution '${executionId}' not found`);
    }
    return status;
  }

  streamExecutionEvents(tenantId: string): Observable<MessageEvent> {
    const subjects = [
      YOIZENCLAW_EXECUTION_STARTED,
      YOIZENCLAW_EXECUTION_COMPLETED,
      YOIZENCLAW_EXECUTION_FAILED,
    ].map((template) => template.replace("{tenant}", tenantId));

    return createNatsMultiSubjectObservable(this.nc, subjects, (msg) => {
      const payload = msg.json() as { data?: { payload?: YoizenClawExecutionStatus } };
      const status = payload.data?.payload;
      if (!status || status.tenantId !== tenantId) return null;
      return { type: msg.subject, data: status };
    }).pipe(
      map(
        (event) =>
          ({
            type: event.type,
            data: event.data,
          }) as MessageEvent,
      ),
    );
  }

  private async handleResultMessage(msg: JsMsg): Promise<void> {
    const payload = JSON.parse(new TextDecoder().decode(msg.data)) as {
      data?: { payload?: YoizenClawExecutionStatus };
      tenant?: string;
    };
    const status = payload.data?.payload;
    const tenantId = status?.tenantId ?? payload.tenant ?? msg.headers?.get(TENANT_HEADER);
    if (!status || !tenantId) {
      return;
    }
    await this.client.persistExecutionStatus(status);
  }
}
