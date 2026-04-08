import { connect, headers as natsHeaders, type NatsConnection } from "nats";
import type { ChannelSendArgs, Channel, ChannelProvider } from "@yoizen/shared";
import { TENANT_HEADER, buildChannelSubject } from "@yoizen/shared";
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
 * @param args - Outbound message details (account, recipient, content)
 * @param tenantId - Tenant that owns the workflow
 * @returns Confirmation with the NATS subject used
 */
export async function executeChannelSend(
  args: ChannelSendArgs,
  tenantId: string,
): Promise<{ published: true; subject: string }> {
  const conn = await getConnection();

  const subject = buildChannelSubject(
    tenantId,
    args.channel as Channel,
    args.provider as ChannelProvider,
    "send",
  );

  const envelope = {
    id: crypto.randomUUID(),
    specversion: "1.0" as const,
    type: `io.yoizen.messaging.${args.channel}.${args.provider}.send.v1`,
    source: `//workflow-service/channel-send`,
    time: new Date().toISOString(),
    datacontenttype: "application/json" as const,
    subject,
    data: {
      accountId: args.accountId,
      to: args.to,
      type: args.type,
      text: args.text,
      templateName: args.templateName,
      templateLanguage: args.templateLanguage,
      templateComponents: args.templateComponents,
      mediaUrl: args.mediaUrl,
      caption: args.caption,
    },
    tenantId,
    channel: args.channel,
    provider: args.provider,
    kind: "send" as const,
    idempotencyKey: `${tenantId}:${args.channel}:send:${crypto.randomUUID()}`,
  };

  const hdrs = natsHeaders();
  hdrs.set(TENANT_HEADER, tenantId);
  hdrs.set("Nats-Msg-Id", envelope.idempotencyKey);

  conn.publish(
    subject,
    encoder.encode(JSON.stringify(envelope)),
    { headers: hdrs },
  );
  await conn.flush();

  return { published: true, subject };
}
