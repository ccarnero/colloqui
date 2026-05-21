import { randomUUID } from "node:crypto";
import {
  headers as natsHeaders,
  type JetStreamClient,
  type Msg,
  type NatsConnection,
  type Subscription,
} from "nats";
import {
  PENDING_KEY_PREFIX,
  PENDING_TTL,
  RESULT_KEY_PREFIX,
  RESULT_TTL,
  YOIZENCLAW_RUNTIME_GATEWAY_PRODUCER,
  YOIZENCLAW_DOMAIN,
  YOIZENCLAW_CHANNEL,
  YOIZENCLAW_PROVIDER,
  YOIZENCLAW_EXECUTION_COMPLETED,
  YOIZENCLAW_EXECUTION_FAILED,
  YOIZENCLAW_EXECUTION_REQUESTED,
  YOIZENCLAW_EXECUTION_STARTED,
  buildYoizenClawSubject,
} from "./constants";
import { buildEventEnvelope, canonicalJson, computeIdempotencyKey } from "./envelope.utils";
import type {
  YoizenClawChatExecutionInput,
  YoizenClawExecutionRequest,
  YoizenClawExecutionStatus,
  YoizenClawExecutionSubmitted,
} from "./yoizenclaw-execution.interfaces";

const EXECUTION_RESULT_EVENT_SUBJECTS = [
  YOIZENCLAW_EXECUTION_STARTED,
  YOIZENCLAW_EXECUTION_COMPLETED,
  YOIZENCLAW_EXECUTION_FAILED,
] as const;

function buildStatusKey(tenantId: string, executionId: string): string {
  return `${tenantId}:${RESULT_KEY_PREFIX}${executionId}`;
}

function buildPendingKey(tenantId: string, executionId: string): string {
  return `${tenantId}:${PENDING_KEY_PREFIX}${executionId}`;
}

export interface YoizenClawExecutionCache {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export interface YoizenClawExecutionClientOptions {
  nc: NatsConnection;
  js: JetStreamClient;
  cache: YoizenClawExecutionCache;
  serviceName: string;
}

export interface SubmitExecutionOptions {
  requestedBy?: string;
  correlationId?: string;
  causationId?: string;
  depth?: number;
  executionId?: string;
}

export class YoizenClawExecutionClient {
  constructor(private readonly options: YoizenClawExecutionClientOptions) {}

  async submitExecution(
    tenantId: string,
    input: YoizenClawChatExecutionInput,
    submitOptions: SubmitExecutionOptions = {},
  ): Promise<YoizenClawExecutionSubmitted> {
    const executionId = submitOptions.executionId ?? randomUUID();
    const requestedAt = new Date().toISOString();

    const request: YoizenClawExecutionRequest = {
      executionId,
      type: "chat",
      tenantId,
      requestedAt,
      requestedBy: submitOptions.requestedBy,
      input,
      correlationId: submitOptions.correlationId ?? executionId,
      causationId: submitOptions.causationId,
      depth: submitOptions.depth ?? 0,
    };

    const pending: YoizenClawExecutionStatus = {
      executionId,
      tenantId,
      type: "chat",
      state: "pending",
      requestedAt,
      requestedBy: submitOptions.requestedBy,
      agentId: input.agentId,
      correlationId: submitOptions.correlationId ?? executionId,
      causationId: submitOptions.causationId,
    };

    await this.options.cache.setex(
      buildPendingKey(tenantId, executionId),
      PENDING_TTL,
      JSON.stringify({ executionId, status: "pending" }),
    );
    await this.options.cache.setex(
      buildStatusKey(tenantId, executionId),
      RESULT_TTL,
      JSON.stringify(pending),
    );

    const subject = buildYoizenClawSubject(
      YOIZENCLAW_EXECUTION_REQUESTED,
      tenantId,
    );

    const envelope = buildEventEnvelope({
      type: "io.yoizen.yoizenclaw.runtime.execution_requested.v1",
      source: this.options.serviceName,
      resource: `execution/${executionId}`,
      tenant: tenantId,
      producer: YOIZENCLAW_RUNTIME_GATEWAY_PRODUCER,
      domain: YOIZENCLAW_DOMAIN,
      channel: YOIZENCLAW_CHANNEL,
      provider: YOIZENCLAW_PROVIDER,
      accountid: YOIZENCLAW_RUNTIME_GATEWAY_PRODUCER,
      payload: request as unknown as Record<string, unknown>,
      time: requestedAt,
      correlationId: submitOptions.correlationId ?? executionId,
      causationId: submitOptions.causationId,
      depth: submitOptions.depth ?? 0,
    });

    const hdrs = natsHeaders();
    hdrs.set("Nats-Msg-Id", computeIdempotencyKey(request));
    hdrs.set("X-Execution-Id", executionId);
    hdrs.set("X-Execution-Type", request.type);
    hdrs.set("X-Producer-Service", this.options.serviceName);
    if (request.correlationId) {
      hdrs.set("X-Correlation-Id", request.correlationId);
    }
    if (request.causationId) {
      hdrs.set("X-Causation-Id", request.causationId);
    }

    await this.options.js.publish(subject, canonicalJson(envelope), {
      headers: hdrs,
      msgID: computeIdempotencyKey(request),
    });

    return { executionId, status: "accepted" };
  }

  async getExecutionResult(
    tenantId: string,
    executionId: string,
  ): Promise<YoizenClawExecutionStatus | null> {
    const raw = await this.options.cache.get(buildStatusKey(tenantId, executionId));
    if (!raw) return null;
    return JSON.parse(raw) as YoizenClawExecutionStatus;
  }

  async waitForExecutionResult(
    tenantId: string,
    executionId: string,
    timeoutMs: number,
  ): Promise<YoizenClawExecutionStatus> {
    const existing = await this.getExecutionResult(tenantId, executionId);
    if (existing && (existing.state === "completed" || existing.state === "failed")) {
      return existing;
    }

    const subjects = EXECUTION_RESULT_EVENT_SUBJECTS.map((template) =>
      buildYoizenClawSubject(template, tenantId),
    );

    return new Promise<YoizenClawExecutionStatus>((resolve, reject) => {
      const subscriptions: Subscription[] = [];
      let settled = false;
      const closeAll = () => {
        for (let i = 0; i < subscriptions.length; i++) {
          subscriptions[i]?.unsubscribe();
        }
      };

      const timeoutRef = setTimeout(async () => {
        if (settled) return;
        settled = true;
        closeAll();
        const latest = await this.getExecutionResult(tenantId, executionId);
        if (latest && (latest.state === "completed" || latest.state === "failed")) {
          resolve(latest);
          return;
        }
        reject(new Error(`Timeout waiting for YoizenClaw execution '${executionId}'`));
      }, timeoutMs);

      const onMessage = async (data: Uint8Array) => {
        if (settled) return;
        try {
          const parsed = JSON.parse(new TextDecoder().decode(data)) as {
            data?: { payload?: YoizenClawExecutionStatus };
            executionId?: string;
            state?: string;
          };
          const payload = parsed.data?.payload ?? (parsed as unknown as YoizenClawExecutionStatus);
          if (!payload || payload.executionId !== executionId) return;
          if (payload.state !== "completed" && payload.state !== "failed") return;
          settled = true;
          clearTimeout(timeoutRef);
          closeAll();
          resolve(payload);
        } catch {
          // Ignore foreign/non-JSON messages on the subscribed subjects.
        }
      };

      for (let i = 0; i < subjects.length; i++) {
        subscriptions.push(
          this.options.nc.subscribe(subjects[i]!, {
            callback: (error: Error | null, message: Msg) => {
              if (error || !message) return;
              void onMessage(message.data);
            },
          }),
        );
      }
    });
  }

  async executeAndWait(
    tenantId: string,
    input: YoizenClawChatExecutionInput,
    timeoutMs: number,
    submitOptions: SubmitExecutionOptions = {},
  ): Promise<YoizenClawExecutionStatus> {
    const submitted = await this.submitExecution(tenantId, input, submitOptions);
    return this.waitForExecutionResult(tenantId, submitted.executionId, timeoutMs);
  }

  async persistExecutionStatus(status: YoizenClawExecutionStatus): Promise<void> {
    await this.options.cache.setex(
      buildStatusKey(status.tenantId, status.executionId),
      RESULT_TTL,
      JSON.stringify(status),
    );
    if (status.state === "completed" || status.state === "failed") {
      await this.options.cache.del(buildPendingKey(status.tenantId, status.executionId));
    }
  }
}
