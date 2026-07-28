import { Inject, Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import {
  buildEventEnvelope,
  buildSubject,
  DepthExceededError,
  deriveEnvelope,
  type EventEnvelope,
} from "@yoizen/shared";
import type { JetStreamClient } from "nats";
import { JETSTREAM } from "../../providers/nats.provider";
import { truncateText } from "./truncate-text";

/**
 * Payload for `ai.llm_call.completed.v1`
 * (`manual-loops/connectors/connection-call-inspector.md` T04, decision 7).
 * Emitted ONLY for LLM calls made OUTSIDE chat executions (the job-executor
 * `llm_call` action, `llm-action.service.ts`) — chat executions already
 * carry their payload in `execution_completed`
 * (`nats-handlers/execution.handler.ts:245-292`) and must NOT be
 * double-captured.
 */
export interface ILlmCallEventPayload {
  readonly tenantId: string;
  readonly agentId: string;
  readonly executionId: string;
  readonly model: string;
  readonly provider: string;
  /** Prompt text, truncated to 8192 chars before publish. */
  readonly prompt: string;
  /** Completion text, truncated to 8192 chars before publish. */
  readonly completion: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
  readonly costUsd: number;
  readonly durationMs: number;
  /**
   * Incoming envelope from the event that triggered this job, when the
   * caller has one (job-executor's `envelope` param, threaded down from
   * `job-executor.service.ts`'s `executeJob`). `undefined` means this call
   * is a causal root (e.g. a directly-triggered job with no upstream
   * envelope).
   */
  readonly causalEnvelope?: EventEnvelope;
}

/**
 * Fire-and-forget publisher for `ai.llm_call.completed.v1`. Emission
 * NEVER fails or delays the LLM call itself — every failure path here logs
 * a warning and returns, mirroring
 * `connector-runtime/src/activities/_shared/event-publisher.ts:70-188`'s
 * `publishEndpointCallEvent`/`publishMcpCallEvent` contract (the loop's
 * prior art for this emission pattern), adapted to this service's existing
 * `deriveEnvelope`/`buildEventEnvelope` + injected `JETSTREAM` client
 * conventions (`nats-handlers/execution.handler.ts:366-397`).
 */
@Injectable()
export class LlmCallEventPublisherService {
  private readonly logger = new PinoLoggerService(
    LlmCallEventPublisherService.name
  );

  constructor(@Inject(JETSTREAM) private readonly js: JetStreamClient) {}

  publish(evt: ILlmCallEventPayload): void {
    void this.emit(evt).catch((err) => {
      this.logger.warn(
        `[llm-call] event publish failed for tenant='${evt.tenantId}' execution='${evt.executionId}': ${err instanceof Error ? err.message : String(err)}`
      );
    });
  }

  private async emit(evt: ILlmCallEventPayload): Promise<void> {
    const payload: Record<string, unknown> = {
      model: evt.model,
      provider: evt.provider,
      prompt: truncateText(evt.prompt),
      completion: truncateText(evt.completion),
      inputTokens: evt.inputTokens,
      outputTokens: evt.outputTokens,
      cachedInputTokens: evt.cachedInputTokens ?? 0,
      costUsd: evt.costUsd,
      durationMs: evt.durationMs,
    };

    const type = "ai.llm_call.completed.v1";
    const source = "//agent-ai-service/llm-call";
    const resource = `execution/${evt.executionId}`;
    const producer = "agent-ai-service";
    const domain = "platform";
    const channel = "llm";
    const provider = "system";

    let envelope: EventEnvelope;
    try {
      envelope = evt.causalEnvelope
        ? deriveEnvelope(evt.causalEnvelope, {
            id: crypto.randomUUID(),
            type,
            source,
            resource,
            producer,
            domain,
            channel,
            provider,
            accountid: evt.tenantId,
            payload,
          })
        : buildEventEnvelope({
            type,
            source,
            resource,
            tenant: evt.tenantId,
            producer,
            domain,
            channel,
            provider,
            accountid: evt.tenantId,
            payload,
          });
    } catch (err) {
      if (err instanceof DepthExceededError) {
        // Never let causal threading break the fire-and-forget publish
        // path: fall back to a root event (no correlation/causation
        // inherited) and warn so the depth cap breach is visible in logs.
        // Same fallback contract as connector-runtime's event-publisher.ts.
        this.logger.warn(
          `[llm-call] event depth exceeded for tenant='${evt.tenantId}' execution='${evt.executionId}', publishing as root event: ${err.message}`
        );
        envelope = buildEventEnvelope({
          type,
          source,
          resource,
          tenant: evt.tenantId,
          producer,
          domain,
          channel,
          provider,
          accountid: evt.tenantId,
          payload,
        });
      } else {
        throw err;
      }
    }

    const subject = buildSubject({
      tenant: evt.tenantId,
      producer,
      domain,
      channel,
      provider,
      kind: "llm_call_completed",
    });

    await this.js.publish(subject, JSON.stringify(envelope));

    this.logger.log(
      `[llm-call] published event execution='${evt.executionId}' model='${evt.model}' provider='${evt.provider}' tokens=${evt.inputTokens + evt.outputTokens}`
    );
  }
}
