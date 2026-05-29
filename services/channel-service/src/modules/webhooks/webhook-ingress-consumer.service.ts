import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { JetStreamClient, JetStreamManager, JsMsg } from "nats";
import { headers as natsHeaders } from "nats";
import {
  PinoLoggerService,
  createNatsConsumerMetrics,
  isWorkerMode,
  resolveServiceName,
  startNatsConsumerSpan,
} from "@yoizen/observability";
import { context as otelContext } from "@opentelemetry/api";
import {
  MultiTenantConsumerManager,
  type IMultiTenantConsumerConfig,
} from "@yoizen/database";
import {
  WEBHOOK_INGRESS_SUBJECT_FILTER,
  parseWebhookIngressSubject,
  type WebhookIngressEnvelope,
} from "@yoizen/shared";
import {
  JETSTREAM_MANAGER,
  JETSTREAM_PUBLISHER,
} from "../../providers/nats.provider";
import { WebhookIngressService } from "./webhook-ingress.service";

const DURABLE_NAME = "channel-webhook-ingress";
const TENANT_STREAM_PATTERN = /^INGRESS-/;
/** Webhook ingress is mostly I/O bound (DB lookup + routing + ingress publish). */
function resolveWebhookIngressConcurrency(): number {
  const raw = process.env.WEBHOOK_INGRESS_HANDLER_CONCURRENCY;
  if (raw === undefined || raw === "") return 32;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 32;
}

const HANDLER_CONCURRENCY = resolveWebhookIngressConcurrency();

@Injectable()
export class WebhookIngressConsumerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new PinoLoggerService(
    WebhookIngressConsumerService.name,
  );
  private readonly decoder = new TextDecoder();
  private manager: MultiTenantConsumerManager | null = null;

  constructor(
    @Inject(JETSTREAM_MANAGER) private readonly jsm: JetStreamManager,
    @Inject(JETSTREAM_PUBLISHER) private readonly js: JetStreamClient,
    private readonly webhookIngress: WebhookIngressService,
  ) {}

  async onModuleInit(): Promise<void> {
    const ensureOnly = !isWorkerMode();
    const config: IMultiTenantConsumerConfig = {
      streamPattern: TENANT_STREAM_PATTERN,
      durableName: DURABLE_NAME,
      filterSubject: WEBHOOK_INGRESS_SUBJECT_FILTER,
      description: "Channel webhook ingress from api-gateway",
      metrics: createNatsConsumerMetrics(resolveServiceName("channel-service")),
      runnerOptions: { concurrency: HANDLER_CONCURRENCY },
      ensureOnly,
    };
    this.manager = new MultiTenantConsumerManager(
      this.jsm,
      this.js,
      config,
      (msg: JsMsg) => this.handleJsMessage(msg),
      this.logger,
    );
    await this.manager.start();
    this.logger.log(
      ensureOnly
        ? `Pre-created '${DURABLE_NAME}' durable consumer (api mode, ensure-only)`
        : `Webhook ingress durable consumer ('${DURABLE_NAME}') started`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.manager) {
      await this.manager.stop();
      this.manager = null;
    }
  }

  /**
   * Continues the OTel trace published by api-gateway across the
   * JetStream hop: extracts `traceparent` from the message headers and
   * opens a CONSUMER span so the webhook → ingress → workflow chain
   * shows up as a single end-to-end trace. Without this the consumer
   * work lands in a disconnected trace — mirrors the egress path in
   * `send-command-consumer.service.ts`.
   */
  private async handleJsMessage(msg: JsMsg): Promise<void> {
    const incomingHeaders = msg.headers ?? natsHeaders();
    const { span, context: spanCtx } = startNatsConsumerSpan(
      resolveServiceName("channel-service"),
      msg.subject,
      incomingHeaders,
    );
    try {
      await otelContext.with(spanCtx, () => this.processMessage(msg));
    } finally {
      span.end();
    }
  }

  private async processMessage(msg: JsMsg): Promise<void> {
    const subject = parseWebhookIngressSubject(msg.subject);
    if (!subject) {
      this.logger.warn(`Ignoring non-webhook subject: ${msg.subject}`);
      return;
    }

    const envelope = this.decodeEnvelope(msg.data);
    if (!envelope) {
      this.logger.warn(`Dropping non-JSON webhook envelope: ${msg.subject}`);
      return;
    }

    if (envelope.tenant !== subject.tenant) {
      this.logger.warn(
        `Tenant mismatch in webhook envelope: subject=${subject.tenant} envelope=${envelope.tenant}`,
      );
      return;
    }

    const rawBody = this.decodeRawBody(envelope.data?.raw_body_b64);
    if (!rawBody) {
      this.logger.warn(
        `Dropping webhook envelope without valid raw_body_b64: ${msg.subject}`,
      );
      return;
    }

    await this.webhookIngress.processEnvelope(
      subject.channel,
      subject.tenant,
      rawBody,
      this.normalizeHeaders(envelope.data?.headers),
      envelope.data?.payload ?? null,
    );
  }

  private decodeEnvelope(data: Uint8Array): WebhookIngressEnvelope | null {
    try {
      return JSON.parse(this.decoder.decode(data)) as WebhookIngressEnvelope;
    } catch {
      return null;
    }
  }

  private decodeRawBody(rawBodyBase64: unknown): Buffer | null {
    if (typeof rawBodyBase64 !== "string" || rawBodyBase64.length === 0) {
      return null;
    }
    try {
      const decoded = Buffer.from(rawBodyBase64, "base64");
      return decoded.length > 0 ? decoded : null;
    } catch {
      return null;
    }
  }

  private normalizeHeaders(headers: unknown): Record<string, string> {
    if (typeof headers !== "object" || headers === null) return {};
    const normalized = new Map<string, string>();
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === "string") {
        normalized.set(key.toLowerCase(), value);
      }
    }
    return Object.fromEntries(normalized);
  }
}
