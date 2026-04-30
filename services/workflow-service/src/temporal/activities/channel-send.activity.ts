import { connect, headers as natsHeaders, type NatsConnection } from "nats";
import type {
  Channel,
  ChannelEnvelope,
  ChannelProvider,
  ChannelSendArgs,
  EventCausalContext,
  JsonValue,
} from "@yoizen/shared";
import {
  buildChannelSubject,
  canonicalByteLength,
  CHANNEL_PRODUCER,
  CHANNEL_DOMAIN,
  computeIdempotencyKey,
  computePayloadChecksum,
  TENANT_HEADER,
} from "@yoizen/shared";
import {
  activeOrRandomTraceId,
  injectTraceContext,
  startNatsProducerSpan,
} from "@yoizen/observability";
import { workflowServiceConfig } from "../../config";

let nc: NatsConnection | null = null;
const encoder = new TextEncoder();

async function getConnection(): Promise<NatsConnection> {
  if (nc && !nc.isClosed()) return nc;
  const url = workflowServiceConfig.natsUrl;
  nc = await connect({ servers: url });
  return nc;
}

/**
 * Publishes a channel send command to the per-tenant INGRESS
 * JetStream stream. The channel-service picks it up and
 * delivers via the appropriate provider (WhatsApp / Telegram).
 *
 * The envelope is wdocs-02 compliant: `payload_checksum` is the pure
 * canonical hash of the outbound payload; `idempotencykey` (and the
 * `Nats-Msg-Id` header derived from it) is scoped by
 * `{payload, correlation_id, causation_id}` so that:
 *
 *  - Temporal activity retries for the same trigger collapse to a
 *    single stream entry (same scope → same hash → JetStream dedup).
 *  - Distinct trigger events producing identical outbound payloads
 *    (e.g. the classic "send `hi` to the same user twice") yield
 *    distinct scopes and therefore distinct keys, so both reach the
 *    channel-service consumer.
 *
 * `traceid` comes from the active OTEL span; when an
 * {@link EventCausalContext} is provided, `causation_id`,
 * `correlation_id` and `transport.depth` are inherited from the
 * triggering envelope (§6 of wdocs-02).
 *
 * @param args - Outbound message details (account, recipient, content).
 * @param tenantId - Tenant that owns the workflow.
 * @param causal - Optional causal chain inherited from the upstream
 *   event. When absent the envelope is treated as a causal root
 *   (`causation_id = null`, self-referencing `correlation_id`,
 *   `transport.depth = 1` — one step from the implicit root).
 * @returns Confirmation with the NATS subject used.
 */
export async function executeChannelSend(
  args: ChannelSendArgs,
  tenantId: string,
  causal?: EventCausalContext,
): Promise<{ published: true; subject: string }> {
  const conn = await getConnection();

  const channel = args.channel as Channel;
  const provider = args.provider as ChannelProvider;
  const subject = buildChannelSubject(tenantId, channel, provider, "send");

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const traceid = activeOrRandomTraceId();
  const depth = (causal?.depth ?? 0) + 1;

  const payload: Record<string, JsonValue> = {
    accountId: args.accountId,
    to: args.to,
    type: args.type,
    ...(args.text !== undefined && { text: args.text }),
    ...(args.templateName !== undefined && { templateName: args.templateName }),
    ...(args.templateLanguage !== undefined && {
      templateLanguage: args.templateLanguage,
    }),
    ...(args.templateComponents !== undefined && {
      templateComponents: args.templateComponents as unknown as JsonValue,
    }),
    ...(args.mediaUrl !== undefined && { mediaUrl: args.mediaUrl }),
    ...(args.caption !== undefined && { caption: args.caption }),
  };

  const correlationId = causal?.correlation_id ?? id;
  const causationId = causal?.causation_id ?? null;
  /**
   * Scope the dedup key to the causal chain so that repeated triggers
   * with identical payloads do NOT collapse inside JetStream's
   * `duplicate_window` (default 2 min). Temporal retries of the same
   * activity invocation keep the same scope and therefore the same
   * key, so legitimate retries still dedup server-side.
   */
  const idempotencykey = computeIdempotencyKey({
    payload,
    correlation_id: correlationId,
    causation_id: causationId,
  });
  const payloadChecksum = computePayloadChecksum(payload);
  const payloadBytes = canonicalByteLength(payload);
  const resource = `tenant/${tenantId}/account/${args.accountId}/channel/${channel}/provider/${provider}`;

  const envelope: ChannelEnvelope = {
    specversion: "1.0",
    id,
    source: "//workflow-service/channel-send",
    type: `io.yoizen.messaging.${channel}.${provider}.send.v1`,
    resource,
    time: now,
    traceid,
    causation_id: causationId,
    correlation_id: correlationId,
    tenant: tenantId,
    producer: CHANNEL_PRODUCER,
    domain: CHANNEL_DOMAIN,
    channel,
    provider,
    accountid: args.accountId,
    idempotencykey,
    transport: { method: "stream", protocol: "internal", depth },
    data: {
      received_at: now,
      payload_inline: true,
      payload_ref: null,
      payload_bytes: payloadBytes,
      payload_checksum: payloadChecksum,
      payload,
    },
    kind: "send",
  };

  const hdrs = natsHeaders();
  hdrs.set(TENANT_HEADER, tenantId);
  hdrs.set("Nats-Msg-Id", idempotencykey);
  hdrs.set("X-Correlation-Id", correlationId);
  if (causationId) hdrs.set("X-Causation-Id", causationId);
  injectTraceContext(hdrs);

  const { span } = startNatsProducerSpan(
    "workflow-service",
    subject,
    hdrs,
  );

  try {
    conn.publish(subject, encoder.encode(JSON.stringify(envelope)), {
      headers: hdrs,
    });
    await conn.flush();
  } finally {
    span.end();
  }

  return { published: true, subject };
}
