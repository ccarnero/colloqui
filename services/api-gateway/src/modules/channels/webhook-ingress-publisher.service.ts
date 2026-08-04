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
import { gatewayConfig } from "../../config";
import { WebhookPublishUnavailableError } from "./webhook-publish-unavailable.error";
import { buildWebhookIngressType } from "./webhook-ingress-type";
import type { IYoizenRequest } from "../../types/yoizen-request";

interface IPublishWebhookParams {
  tenantId: string;
  channel: Channel;
  /**
   * Optional account `externalId` from the instance-addressed ingress URL
   * (`/api/webhooks/<channel>/<tenant>/<instance>`). Forwarded verbatim so
   * channel-service can resolve the account by `(channel, externalId)`.
   */
  instance?: string;
  rawBody: Buffer;
  headers: Record<string, unknown>;
  parsedBody: unknown;
  /** The Fastify request — correlation IDs are stamped onto it so the audit interceptor can read them. */
  request?: IYoizenRequest;
}

@Injectable()
export class WebhookIngressPublisherService {
  private readonly encoder = new TextEncoder();
  /**
   * Per-pod cap on concurrent in-flight `publishWebhook` calls.
   * Introduced by the 2026-05-22 stress post-mortem
   * (`post-mortem/POST-MORTEM.md` §P1.2): when JetStream's publish-ack
   * path stalls, unbounded inflight publishes accumulate and starve the
   * Fastify event loop. A single integer counter is the cheapest
   * possible bound — O(1) per request and zero allocation on the hot
   * path. Reading the cap at the call site rather than caching it
   * keeps the value live across `gatewayConfig` overrides used in
   * tests.
   */
  private inFlight = 0;

  constructor(
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
  ) {}

  async publishWebhook(params: IPublishWebhookParams): Promise<string> {
    const { tenantId, channel, instance, rawBody, headers, parsedBody, request } =
      params;

    /**
     * Enforce the per-pod in-flight cap before we allocate any
     * envelope state — surfaces backpressure as a 503 instantly
     * (O(1) check) rather than building a payload that we then have
     * to discard.
     */
    const cap = gatewayConfig.webhook.publishInflightCap;
    if (this.inFlight >= cap) {
      throw new WebhookPublishUnavailableError(
        `Gateway is busy: ${this.inFlight}/${cap} concurrent webhook` +
          " publishes in flight. Retry shortly.",
      );
    }
    this.inFlight++;

    const id = crypto.randomUUID();
    const correlationId = id;

    // Stamp correlation onto the request BEFORE we yield to the publish path so
    // the audit interceptor (which runs in the response tap) can always read them.
    if (request !== undefined) {
      request.__correlationId = correlationId;
      request.__causationId = null;
      request.__depth = 0;
    }

    const subject = buildWebhookIngressSubject(tenantId, channel);
    const now = new Date().toISOString();
    const payload = this.toPayload(parsedBody, rawBody);
    const payloadBytes = canonicalByteLength(payload);
    const payloadChecksum = computePayloadChecksum(payload);
    const idempotencykey = computeIdempotencyKey(payload);

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
      source: "api-gateway/webhooks",
      type: buildWebhookIngressType(channel),
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
        ...(instance !== undefined && { instance }),
      },
    };

    const hdrs = natsHeaders();
    hdrs.set(TENANT_HEADER, tenantId);
    hdrs.set("Nats-Msg-Id", idempotencykey);
    hdrs.set("X-Correlation-Id", correlationId);
    injectTraceContext(hdrs);

    try {
      await ensureTenantIngressStream(this.jsm, tenantId);

      const { span } = startNatsProducerSpan("api-gateway", subject, hdrs);
      try {
        await this.publishWithTimeout(
          subject,
          this.encoder.encode(JSON.stringify(envelope)),
          hdrs,
        );
      } finally {
        span.end();
      }
    } finally {
      this.inFlight--;
    }

    return id;
  }

  /**
   * Wraps `js.publish` in an explicit timeout so a stalled JetStream
   * ack does NOT hold the request slot open indefinitely. The 2026-05-22
   * stress post-mortem (`post-mortem/POST-MORTEM.md` §3.6) caught 118
   * `NatsError: TIMEOUT` errors in 2 seconds when JetStream was
   * back-pressured by the Temporal/Postgres cascade; this race ensures
   * the caller sees a structured 503 with `Retry-After` instead of an
   * opaque 500 produced by the default client timeout.
   *
   * `setTimeout` is cleared eagerly on the happy path to avoid leaking
   * timers; Node's timer pool is O(log n) on insert so this is the
   * cheapest correct bound.
   */
  private async publishWithTimeout(
    subject: string,
    payload: Uint8Array,
    hdrs: ReturnType<typeof natsHeaders>,
  ): Promise<void> {
    const timeoutMs = gatewayConfig.webhook.publishTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const publishPromise = this.js.publish(subject, payload, {
      headers: hdrs,
    });
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new WebhookPublishUnavailableError(
            `Webhook publish timed out after ${timeoutMs}ms; downstream` +
              " messaging backend is unavailable. Retry shortly.",
          ),
        );
      }, timeoutMs);
    });

    try {
      await Promise.race([publishPromise, timeoutPromise]);
    } catch (err) {
      if (err instanceof WebhookPublishUnavailableError) throw err;
      /**
       * Wrap any other NATS-level failure (TIMEOUT from the client,
       * connection closed mid-publish, etc.) as a 503 too — the
       * upstream provider can always retry safely thanks to the
       * `Nats-Msg-Id` dedup hash.
       */
      const message = err instanceof Error ? err.message : String(err);
      throw new WebhookPublishUnavailableError(
        `Webhook publish failed: ${message}. Retry shortly.`,
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
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
