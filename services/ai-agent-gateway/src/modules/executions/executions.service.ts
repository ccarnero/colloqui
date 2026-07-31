import { randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import type { MessageEvent } from "@nestjs/common";
import {
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import {
  ensureTenantIngressStream,
  type IMultiTenantConsumerConfig,
  MultiTenantConsumerManager,
  REDIS_CLIENT,
} from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import {
  buildPlatformSubject,
  buildRuntimeStreamSubject,
  AI_AGENT_GATEWAY_EXECUTION_COMPLETED,
  AI_AGENT_GATEWAY_EXECUTION_FAILED,
  AI_AGENT_GATEWAY_EXECUTION_STARTED,
  RUNTIME_TOKEN,
  RUNTIME_TOOL_CALL,
  RUNTIME_TOOL_RESULT,
  TENANT_HEADER,
  type YoizenClawChatExecutionInput,
  YoizenClawExecutionClient,
  type YoizenClawExecutionStatus,
} from "@yoizen/shared";
import type Redis from "ioredis";
import type {
  JetStreamClient,
  JetStreamManager,
  JsMsg,
  NatsConnection,
  Subscription,
} from "nats";
import { map, Observable } from "rxjs";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
  NATS_CONNECTION,
} from "../../providers/nats.provider";
import { createNatsMultiSubjectObservable } from "../../utils/nats-stream-observable.util";
import type { CreateExecutionDto } from "./executions.dto";

/**
 * Bounded per-connection relay buffer (DOCS/architecture/runtime-streaming.md
 * §2.4): if the client's socket accumulates more than this many unflushed
 * bytes (true backpressure — the consumer is not draining), the stream is
 * closed with a terminal `failed{reason:"slow_consumer"}` event rather than
 * growing unbounded or silently dropping tokens. The client can recover the
 * final result via `getExecution(id)` (Redis-backed). Measured against
 * `socket.writableLength` on each emit; total stream length is intentionally
 * unbounded — long token streams from fast consumers are legitimate.
 */
const STREAM_RELAY_MAX_BUFFERED_BYTES = 256 * 1024;

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
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    @Inject(REDIS_CLIENT) redis: Redis,
  ) {
    this.client = new YoizenClawExecutionClient({
      nc,
      js: this.js,
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
      this.logger
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
    requestedBy?: string
  ): Promise<{ executionId: string; status: string }> {
    await ensureTenantIngressStream(this.jsm, tenantId);
    return this.client.submitExecution(tenantId, input, {
      requestedBy,
      correlationId: input.conversationId,
    });
  }

  async getExecution(
    tenantId: string,
    executionId: string
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
      AI_AGENT_GATEWAY_EXECUTION_STARTED,
      AI_AGENT_GATEWAY_EXECUTION_COMPLETED,
      AI_AGENT_GATEWAY_EXECUTION_FAILED,
    ].map((template) => template.replace("{tenant}", tenantId));

    return createNatsMultiSubjectObservable(this.nc, subjects, (msg) => {
      const payload = msg.json() as {
        data?: { payload?: YoizenClawExecutionStatus };
      };
      const status = payload.data?.payload;
      if (!status || status.tenantId !== tenantId) {
        return null;
      }
      return { type: msg.subject, data: status };
    }).pipe(
      map(
        (event) =>
          ({
            type: event.type,
            data: event.data,
          }) as MessageEvent
      )
    );
  }

  /**
   * Combined submit + stream: generates the executionId, subscribes to the
   * ephemeral token/tool subjects AND the lifecycle subjects BEFORE
   * submitting the execution — race-free by construction (subscribe happens
   * synchronously inside the Observable's subscriber function, before the
   * `await this.client.submitExecution(...)` call below it resolves).
   * See DOCS/architecture/runtime-streaming.md §2.1 (subscribe-before-submit)
   * and §2.4 (bounded relay buffer / close-on-overflow).
   */
  submitAndStream(
    tenantId: string,
    dto: CreateExecutionDto,
    requestedBy?: string,
    socket?: Socket
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const executionId = randomUUID();
      let terminal = false;
      let closed = false;

      const subscriptions: Subscription[] = [];

      const teardown = (publishCancel: boolean): void => {
        for (const sub of subscriptions) {
          sub.unsubscribe();
        }
        if (publishCancel && !terminal) {
          void this.client
            .publishCancel(tenantId, executionId)
            .catch((error) =>
              this.logger.warn(
                `[executions] Failed to publish cancel for execution='${executionId}': ${error}`
              )
            );
        }
      };

      const closeWithFailure = (reason: string): void => {
        if (closed) {
          return;
        }
        closed = true;
        terminal = true;
        subscriber.next({
          type: "failed",
          data: { executionId, reason },
        } as MessageEvent);
        subscriber.complete();
        teardown(false);
      };

      const emit = (type: string, data: unknown, _rawBytes: number): void => {
        if (closed) {
          return;
        }
        if (socket && socket.writableLength > STREAM_RELAY_MAX_BUFFERED_BYTES) {
          closeWithFailure("slow_consumer");
          return;
        }
        subscriber.next({ type, data } as MessageEvent);
      };

      // 1) Subscribe to ephemeral token/tool subjects — core NATS, never
      //    persisted (DOCS/architecture/runtime-streaming.md §1.1).
      const tokenKindBySuffix: Record<string, string> = {
        [RUNTIME_TOKEN]: "token",
        [RUNTIME_TOOL_CALL]: "tool_call",
        [RUNTIME_TOOL_RESULT]: "tool_result",
      };
      for (const kind of [
        RUNTIME_TOKEN,
        RUNTIME_TOOL_CALL,
        RUNTIME_TOOL_RESULT,
      ] as const) {
        const subject = buildRuntimeStreamSubject(tenantId, executionId, kind);
        subscriptions.push(
          this.nc.subscribe(subject, {
            callback: (error, msg) => {
              if (error || closed) {
                return;
              }
              try {
                const envelope = msg.json() as {
                  data?: { payload?: unknown };
                };
                const payload = envelope.data?.payload;
                if (!payload) {
                  return;
                }
                emit(tokenKindBySuffix[kind]!, payload, msg.data.byteLength);
              } catch {
                // Ignore malformed runtime-stream messages.
              }
            },
          })
        );
      }

      // 2) Subscribe to lifecycle subjects (existing JetStream-originated
      //    events, relayed here via core NATS subscribe — same pattern as
      //    streamExecutionEvents()).
      const lifecycleSubjects = [
        AI_AGENT_GATEWAY_EXECUTION_STARTED,
        AI_AGENT_GATEWAY_EXECUTION_COMPLETED,
        AI_AGENT_GATEWAY_EXECUTION_FAILED,
      ].map((template) => buildPlatformSubject(template, tenantId));

      for (const subject of lifecycleSubjects) {
        subscriptions.push(
          this.nc.subscribe(subject, {
            callback: (error, msg) => {
              if (error || closed) {
                return;
              }
              try {
                // Note: the lifecycle publisher (execution.handler.ts /
                // heartbeat-style publishStatus) emits `state: "started"`
                // at runtime, which is not part of the declared
                // `YoizenClawExecutionState` union ("pending" | "running" |
                // "completed" | "failed") — a pre-existing type/runtime gap
                // in the domain model, not introduced here. Widen locally.
                const envelope = msg.json() as {
                  data?: {
                    payload?: Omit<YoizenClawExecutionStatus, "state"> & {
                      state: string;
                    };
                  };
                };
                const status = envelope.data?.payload;
                if (!status || status.executionId !== executionId) {
                  return;
                }

                if (status.state === "started") {
                  emit("started", status, msg.data.byteLength);
                  return;
                }
                if (status.state === "completed" || status.state === "failed") {
                  if (closed) {
                    return;
                  }
                  closed = true;
                  terminal = true;
                  subscriber.next({
                    type: status.state,
                    data: status,
                  } as MessageEvent);
                  subscriber.complete();
                  teardown(false);
                }
              } catch {
                // Ignore malformed lifecycle messages.
              }
            },
          })
        );
      }

      // 3) Submit AFTER subscriptions are established (race-free — see the
      //    method doc comment above and §2.1 of the design).
      void ensureTenantIngressStream(this.jsm, tenantId)
        .then(() =>
          this.client.submitExecution(
            tenantId,
            { ...dto, stream: true },
            {
              requestedBy,
              correlationId: dto.conversationId,
              executionId,
            }
          )
        )
        .catch((error) => {
          this.logger.error(
            `[executions] Failed to submit streaming execution='${executionId}': ${error}`
          );
          closeWithFailure(
            error instanceof Error ? error.message : "submit_failed"
          );
        });

      // 4) Client disconnect (RxJS unsubscribe / Sse teardown) → publish
      //    cancel unless we already reached a terminal lifecycle state.
      return () => teardown(true);
    });
  }

  private async handleResultMessage(msg: JsMsg): Promise<void> {
    const payload = JSON.parse(new TextDecoder().decode(msg.data)) as {
      id?: string;
      transport?: { depth?: number };
      data?: { payload?: YoizenClawExecutionStatus };
      tenant?: string;
    };
    const status = payload.data?.payload;
    const tenantId =
      status?.tenantId ?? payload.tenant ?? msg.headers?.get(TENANT_HEADER);
    if (!status || !tenantId) {
      return;
    }
    /**
     * Correlation-chain fix 3: the envelope carrying a `completed` status
     * IS the `execution_completed` bus event, so its id (and causal depth)
     * is threaded into the persisted status — workflow-service cites it as
     * `causation_id` in the publications that follow the agent call.
     * Non-completed states and legacy envelopes without an id persist
     * unchanged.
     */
    const enriched: YoizenClawExecutionStatus =
      status.state === "completed" && typeof payload.id === "string"
        ? {
            ...status,
            completedEventId: payload.id,
            ...(typeof payload.transport?.depth === "number" && {
              completedEventDepth: payload.transport.depth,
            }),
          }
        : status;
    await this.client.persistExecutionStatus(enriched);
  }
}
