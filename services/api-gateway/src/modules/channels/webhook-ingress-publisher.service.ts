import { Inject, Injectable } from "@nestjs/common";
import type { JetStreamClient, JetStreamManager } from "nats";
import { headers as natsHeaders } from "nats";
import {
  TENANT_HEADER,
  buildWebhookIngressSubject,
  canonicalByteLength,
  computeIdempotencyKey,
  computePayloadChecksum,
  type Channel,
  type WebhookIngressEnvelope,
  WEBHOOK_FORWARDED_HEADERS_SET,
} from "@yoizen/shared";
import {
  activeOrRandomTraceId,
  injectTraceContext,
  startNatsProducerSpan,
} from "@yoizen/observability";
import { ensureTenantIngressStream } from "@yoizen/database";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
} from "../../providers/nats.provider";

interface IPublishWebhookParams {
  tenantId: string;
  channel: Channel;
  rawBody: Buffer;
  headers: Record<string, unknown>;
  parsedBody: unknown;
}

@Injectable()
export class WebhookIngressPublisherService {
  private readonly encoder = new TextEncoder();

  constructor(
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
  ) {}

  async publishWebhook(params: IPublishWebhookParams): Promise<string> {
    const { tenantId, channel, rawBody, headers, parsedBody } = params;
    const id = crypto.randomUUID();
    const subject = buildWebhookIngressSubject(tenantId, channel);
    const now = new Date().toISOString();
    const payload = this.toPayload(parsedBody, rawBody);
    const payloadBytes = canonicalByteLength(payload);
    const payloadChecksum = computePayloadChecksum(payload);
    const idempotencykey = computeIdempotencyKey(payload);
    const correlationId = id;

    /**
     * `accountid` is deliberately absent: at this stage of the pipeline
     * the webhook request has not been signature-verified yet, and the
     * provider-level account (`whatsapp_business_id`, telegram bot id,
     * etc.) has not been mapped to a `Channel Account` row. Populating
     * it with a placeholder (e.g. `tenantId`) would poison downstream
     * aggregations that group by `account_id` — billing in particular.
     *
     * `channel-service` will emit a canonical `ChannelEnvelope` with the
     * real `accountid` once signature verification succeeds.
     */
    const envelope: WebhookIngressEnvelope = {
      specversion: "1.0",
      id,
      source: "//api-gateway/webhooks",
      type: "io.yoizen.messaging.webhook.received.v1",
      resource: `tenant/${tenantId}/channel/${channel}/provider/webhook`,
      time: now,
      traceid: activeOrRandomTraceId(),
      causation_id: null,
      correlation_id: correlationId,
      tenant: tenantId,
      producer: "api-gateway",
      domain: "messaging",
      channel,
      provider: "webhook",
      kind: "webhook_received",
      idempotencykey,
      transport: {
        method: "webhook",
        protocol: "https",
        depth: 0,
      },
      data: {
        received_at: now,
        payload_inline: true,
        payload_ref: null,
        payload_bytes: payloadBytes,
        payload_checksum: payloadChecksum,
        payload,
        raw_body_b64: rawBody.toString("base64"),
        headers: this.filterHeaders(headers),
      },
    };

    const hdrs = natsHeaders();
    hdrs.set(TENANT_HEADER, tenantId);
    hdrs.set("Nats-Msg-Id", idempotencykey);
    hdrs.set("X-Correlation-Id", correlationId);
    injectTraceContext(hdrs);

    await ensureTenantIngressStream(this.jsm, tenantId);

    const { span } = startNatsProducerSpan("api-gateway", subject, hdrs);
    try {
      await this.js.publish(subject, this.encoder.encode(JSON.stringify(envelope)), {
        headers: hdrs,
      });
    } finally {
      span.end();
    }

    return id;
  }

  private toPayload(
    parsedBody: unknown,
    rawBody: Buffer,
  ): Record<string, unknown> {
    if (
      typeof parsedBody === "object" &&
      parsedBody !== null &&
      !Array.isArray(parsedBody)
    ) {
      return parsedBody as Record<string, unknown>;
    }

    const rawText = rawBody.toString("utf8");
    try {
      const parsed = JSON.parse(rawText) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Body can be non-JSON (provider retries / pings). Keep it observable.
    }
    return { raw_text: rawText };
  }

  private filterHeaders(
    headers: Record<string, unknown>,
  ): Record<string, string> {
    const selected = new Map<string, string>();
    for (const [rawKey, rawValue] of Object.entries(headers)) {
      const key = rawKey.toLowerCase();
      if (!WEBHOOK_FORWARDED_HEADERS_SET.has(key)) continue;
      const value = this.normalizeHeaderValue(rawValue);
      if (value !== null) selected.set(key, value);
    }
    return Object.fromEntries(selected);
  }

  private normalizeHeaderValue(value: unknown): string | null {
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (Array.isArray(value) && value.length > 0) {
      const first = value[0];
      if (typeof first === "string") return first;
      if (typeof first === "number") return String(first);
    }
    return null;
  }
}
