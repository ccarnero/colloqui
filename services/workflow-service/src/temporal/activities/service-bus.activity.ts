import { connect, headers as natsHeaders, type NatsConnection } from "nats";
import type { ServiceBusCallArgs } from "@yoizen/shared";
import { TENANT_HEADER } from "@yoizen/shared";
import { workflowServiceConfig } from "../../config";

let nc: NatsConnection | null = null;
const encoder = new TextEncoder();

async function getConnection(): Promise<NatsConnection> {
  if (nc && !nc.isClosed()) return nc;
  const url = workflowServiceConfig.natsUrl;
  nc = await connect({ servers: url, name: "workflow-service" });
  return nc;
}

export async function executeServiceBusCall(
  args: ServiceBusCallArgs,
  tenantId: string,
): Promise<{ published: true; subject: string }> {
  const conn = await getConnection();

  const hdrs = natsHeaders();
  hdrs.set(TENANT_HEADER, tenantId);
  if (args.headers) {
    const entries = Object.entries(args.headers);
    for (let i = 0; i < entries.length; i++) {
      hdrs.set(entries[i][0], entries[i][1]);
    }
  }

  const payload = args.payload
    ? encoder.encode(JSON.stringify(args.payload))
    : undefined;

  conn.publish(args.subject, payload, { headers: hdrs });
  await conn.flush();

  return { published: true, subject: args.subject };
}
