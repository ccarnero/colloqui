import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { JetStreamClient, JetStreamManager } from "nats";
import { headers as natsHeaders } from "nats";
import type {
  Channel,
  ChannelProvider,
  JsonValue,
  OutboundMessage,
  SendMessageResult,
} from "@yoizen/shared";
import { TENANT_HEADER, buildChannelSubject } from "@yoizen/shared";
import {
  DistributedCircuitBreaker,
  computeBreakerKey,
  PermanentError,
} from "@yoizen/shared";
import { EGRESS_BREAKER } from "./egress-breaker.provider";
import { ensureTenantIngressStream } from "@yoizen/database";
import {
  JETSTREAM_PUBLISHER,
  JETSTREAM_MANAGER,
} from "../../providers/nats.provider";
import {
  PinoLoggerService,
  injectTraceContext,
  logWithEnvelope,
  startNatsProducerSpan,
} from "@yoizen/observability";
import { ChannelRouter } from "../../providers/channel-router";
import { AccountsService } from "../accounts/accounts.service";
import {
  egressMessagesSent,
  egressSendFailures,
  egressSendDuration,
} from "./egress.metrics";
import { UTF8_TEXT_ENCODER } from "../../common/utf8-text-encoder";
import { createChannelSentEnvelope } from "../../domain/envelope.factory";

/** Causal context propagated from the send-command consumer. */
export interface IEgressCausalContext {
  /** Event id of the send-command envelope that triggered this send. */
  readonly causationId: string | null;
  /** Correlation id shared across the whole conversation / flow. */
  readonly correlationId?: string;
  /** Depth of the incoming envelope (we emit depth+1). */
  readonly incomingDepth: number;
}

/** Options for shadow-publishing a sent event to JetStream. */
interface IShadowPublishOptions {
  tenantId: string;
  channel: Channel;
  channelProvider: ChannelProvider;
  accountId: string;
  message: OutboundMessage;
  result: SendMessageResult;
  causal?: IEgressCausalContext;
}

@Injectable()
export class EgressService {
  private readonly logger = new PinoLoggerService(EgressService.name);

  constructor(
    @Inject(JETSTREAM_PUBLISHER) private readonly js: JetStreamClient,
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    private readonly router: ChannelRouter,
    private readonly accounts: AccountsService,
    @Inject(EGRESS_BREAKER)
    private readonly breaker: DistributedCircuitBreaker,
  ) {}

  /**
   * Sends a message via the appropriate channel provider, then
   * shadow-publishes a `sent.v1` event to JetStream.
   *
   * @param causal - Optional causal context. When provided, the
   *   shadow `sent.v1` envelope inherits causation/correlation so the
   *   chain stays intact (wdocs 02 §6).
   */
  async send(
    tenantId: string,
    accountId: string,
    message: OutboundMessage,
    causal?: IEgressCausalContext,
  ): Promise<SendMessageResult> {
    const account = await this.accounts.findById(tenantId, accountId);
    if (!account) {
      throw new NotFoundException(
        `Account '${accountId}' not found for tenant '${tenantId}'`,
      );
    }

    const provider = this.router.getOrThrow(account.channel);
    const attrs = { channel: account.channel, tenant: tenantId };

    const breakerKey = computeBreakerKey({
      tenantId,
      kind: "egress",
      target: `${account.channel}:${account.provider}`,
    });
    const decision = await this.breaker.canProceed(breakerKey);
    if (decision.action === "deny") {
      egressSendFailures.add(1, { ...attrs, reason: "circuit_open" });
      /**
       * Fast-fail without touching the upstream provider. Marked as
       * a PermanentError so the send-command consumer TERMs the
       * message and routes it to DLQ-<tenant>. Redelivery would
       * just pile more load on a known-broken provider.
       */
      throw new PermanentError(
        `circuit_open: ${account.channel}:${account.provider} for tenant=${tenantId} ` +
          `(status=${decision.status}, reason=${decision.reason})`,
        "egress.circuit_breaker",
      );
    }

    const start = performance.now();
    let result: SendMessageResult;
    try {
      result = await provider.sendMessage(account, message);
    } catch (err) {
      egressSendDuration.record(performance.now() - start, attrs);
      egressSendFailures.add(1, attrs);
      this.breaker.recordFailure(breakerKey);
      throw err;
    }
    egressSendDuration.record(performance.now() - start, attrs);

    if (result.success) {
      egressMessagesSent.add(1, attrs);
      this.breaker.recordSuccess(breakerKey);
      await this.shadowPublish({
        tenantId,
        channel: account.channel,
        channelProvider: account.provider,
        accountId,
        message,
        result,
        causal,
      });
    } else {
      egressSendFailures.add(1, attrs);
      this.breaker.recordFailure(breakerKey);
    }

    return result;
  }

  private async shadowPublish(options: IShadowPublishOptions): Promise<void> {
    const {
      tenantId,
      channel,
      channelProvider,
      accountId,
      message,
      result,
      causal,
    } = options;
    try {
      await ensureTenantIngressStream(this.jsm, tenantId);

      const depth = causal ? causal.incomingDepth + 1 : 0;

      const payload: Record<string, JsonValue> = {
        to: message.to,
        type: message.type,
        accountId,
        ...(result.providerMessageId !== undefined && {
          providerMessageId: result.providerMessageId,
        }),
      };

      const envelope = createChannelSentEnvelope({
        tenantId,
        channel,
        provider: channelProvider,
        accountId,
        kind: "sent",
        source: `//channel-service/accounts/${accountId}`,
        type: `io.yoizen.messaging.${channel}.${channelProvider}.sent.v1`,
        payload,
        ...(causal?.correlationId && { correlationId: causal.correlationId }),
        ...(causal?.causationId && { causationId: causal.causationId }),
        depth,
      });
      const subject = buildChannelSubject(
        tenantId,
        channel,
        channelProvider,
        "sent",
      );

      const hdrs = natsHeaders();
      hdrs.set(TENANT_HEADER, tenantId);
      hdrs.set("Nats-Msg-Id", envelope.idempotencykey);
      hdrs.set("X-Correlation-Id", envelope.correlation_id);
      if (envelope.causation_id) {
        hdrs.set("X-Causation-Id", envelope.causation_id);
      }
      injectTraceContext(hdrs);

      const { span } = startNatsProducerSpan(
        "channel-service",
        subject,
        hdrs,
      );

      try {
        await this.js.publish(
          subject,
          UTF8_TEXT_ENCODER.encode(JSON.stringify(envelope)),
          { headers: hdrs },
        );
      } finally {
        span.end();
      }
    } catch (err) {
      logWithEnvelope(
        this.logger,
        null,
        "egress.shadow_publish_failed",
        `Shadow publish failed: ${err instanceof Error ? err.message : err}`,
        "warn",
      );
    }
  }
}
