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
  PLATFORM_EXECUTION_COMPLETED,
  PLATFORM_EXECUTION_FAILED,
  PLATFORM_EXECUTION_STARTED,
  type YoizenClawChatExecutionInput,
  type YoizenClawExecutionStatus,
} from "@yoizen/shared";
import { PinoLoggerService } from "@yoizen/observability";
import { createNatsMultiSubjectObservable } from "../../utils/nats-stream-observable.util";
import { JETSTREAM, JETSTREAM_MANAGER, NATS_CONNECTION } from "../../providers/nats.provider";
import type { NatsConnection } from "nats";

const DURABLE_NAME = "ai-agent-gateway-results";
const TENANT_STREAM_PATTERN = /^INGRESS-/;
const RESULT_SUBJECTS = [
  "evt.*.ai-agent-gateway.automation.platform.internal.execution_started.v1",
  "evt.*.ai-agent-gateway.automation.platform.internal.execution_completed.v1",
  "evt.*.ai-agent-gateway.automation.platform.internal.execution_failed.v1",
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
      serviceName: "ai-agent-gateway",
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
  ): Promise<Record<string, unknown>> {
    const status = await this.client.getExecutionResult(tenantId, executionId);
    if (!status) {
      throw new NotFoundException(`Execution '${executionId}' not found`);
    }

    // Map to frontend-compatible format
    // Frontend expects: { state, result: { reply, toolCalls, usage, costUsd, model, provider } }
    // Redis stores: { state, response, toolCalls, usage, costUsd, model, provider } at root
    const response = (status as any).response ?? (status as any).reply ?? "";
    const toolCalls = (status as any).toolCalls;
    const usage = (status as any).usage;
    const costUsd = (status as any).costUsd;
    const model = (status as any).model;
    const provider = (status as any).provider;

    return {
      executionId: status.executionId,
      tenantId: status.tenantId,
      type: status.type ?? "chat",
      state: status.state,
      requestedAt: status.requestedAt,
      startedAt: (status as any).startedAt,
      completedAt: (status as any).completedAt,
      agentId: status.agentId,
      result: {
        reply: response,
        response: response,
        toolCalls: toolCalls ?? undefined,
        usage: usage ?? undefined,
        costUsd: costUsd ?? undefined,
        model: model ?? undefined,
        provider: provider ?? undefined,
      },
    };
  }

  streamExecutionEvents(tenantId: string): Observable<MessageEvent> {
    const subjects = [
      PLATFORM_EXECUTION_STARTED,
      PLATFORM_EXECUTION_COMPLETED,
      PLATFORM_EXECUTION_FAILED,
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
