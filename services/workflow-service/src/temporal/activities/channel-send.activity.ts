import { connect, headers as natsHeaders, type NatsConnection } from "nats";
import type {
  Channel,
  ChannelEnvelope,
  ChannelProvider,
  ChannelSendArgs,
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
 * The envelope is wdocs-02 compliant: deterministic
 * `idempotencykey = sha256:canonical(args)`, `traceid` from the active
 * OTEL span, `causation_id` / `correlation_id` propagated when the
 * caller provides them in `args`.
 *
 * @param args - Outbound message details (account, recipient, content)
 * @param tenantId - Tenant that owns the workflow
 * @returns Confirmation with the NATS subject used
 */
export async function executeChannelSend(
  args: ChannelSendArgs & {
    causationId?: string | null;
    correlationId?: string;
    incomingDepth?: number;
  },
  tenantId: string,
): Promise<{ published: true; subject: string }> {
  const conn = await getConnection();

  const channel = args.channel as Channel;
  const provider = args.provider as ChannelProvider;
  const subject = buildChannelSubject(tenantId, channel, provider, "send");

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const traceid = activeOrRandomTraceId();
  const depth = (args.incomingDepth ?? 0) + 1;

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

  const idempotencykey = computeIdempotencyKey(payload);
  const payloadChecksum = computePayloadChecksum(payload);
  const payloadBytes = canonicalByteLength(payload);
  const correlationId = args.correlationId ?? id;
  const causationId = args.causationId ?? null;
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
