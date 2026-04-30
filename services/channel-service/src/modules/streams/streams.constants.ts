import { buildDlqStreamName, getTenantStreamName } from "@yoizen/shared";

export const INGRESS_STREAM_KIND = "ingress" as const;
export const DLQ_STREAM_KIND = "dlq" as const;

/**
 * Parses a UI-friendly stream identifier (`ingress` | `dlq`) into
 * the actual NATS stream name for the given tenant. Keeps the UI
 * decoupled from the server-side naming convention.
 */
export function streamNameFor(
  kind: typeof INGRESS_STREAM_KIND | typeof DLQ_STREAM_KIND,
  tenantId: string,
): string {
  return kind === INGRESS_STREAM_KIND
    ? getTenantStreamName(tenantId)
    : buildDlqStreamName(tenantId);
}
