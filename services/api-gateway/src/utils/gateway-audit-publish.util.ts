import { headers as natsHeaders } from "nats";
import type { JetStreamClient } from "nats";
import type { GatewayAuditEvent } from "@yoizen/shared";
import { GATEWAY_AUDIT_SUBJECT, TENANT_HEADER } from "@yoizen/shared";

const defaultEncoder = new TextEncoder();

/**
 * Publishes a gateway audit event to JetStream (fire-and-forget with `onError`).
 */
export function publishGatewayAuditEvent(params: {
  readonly js: JetStreamClient;
  readonly event: GatewayAuditEvent;
  readonly tenantId: string | null;
  readonly onError: (err: unknown) => void;
  readonly encoder?: TextEncoder;
}): void {
  const { js, event, tenantId, onError } = params;
  const enc = params.encoder ?? defaultEncoder;
  const hdrs = natsHeaders();
  if (tenantId) hdrs.set(TENANT_HEADER, tenantId);
  void js
    .publish(GATEWAY_AUDIT_SUBJECT, enc.encode(JSON.stringify(event)), {
      headers: hdrs,
    })
    .catch(onError);
}
