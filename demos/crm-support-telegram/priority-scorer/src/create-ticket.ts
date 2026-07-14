/**
 * Fires the ASYNC `connectors.invoke()` call that creates a HubSpot support
 * ticket (`create-ticket` endpoint, T03), with an `idempotencyKey` (at-least-
 * once delivery caveat — `sdk/README.md` "connectors.invoke()") and a
 * webhook pointing back at this service's own `/webhooks/invoke` (SPEC T05).
 */
import type { ScorerConfig } from "./config.js";
import { log } from "./lib/logging.js";

export interface InvokeAsyncCapableClient {
  connectors: {
    invoke(
      connectorId: string,
      endpointId: string,
      args: { method: string; data?: unknown },
      opts: {
        mode: "async";
        idempotencyKey: string;
        webhook: { url: string; headers?: Record<string, string> };
      }
    ): Promise<{ invocationId: string }>;
  };
}

export interface CreateTicketRequest {
  tenant: string;
  conversationId: string;
  turn: string | number;
  ticket: Record<string, unknown>;
  // Allows CreateTicketRequest to satisfy the `Record<string, unknown>` type
  // predicate in `./server.ts`'s `isCreateTicketRequest` guard.
  [key: string]: unknown;
}

export interface CreateTicketResult {
  invocationId: string;
  idempotencyKey: string;
}

/** `ticket-<tenant>-<conversationId>-<turn>` — the exact SPEC T05 format. */
export function buildTicketIdempotencyKey(
  request: Pick<CreateTicketRequest, "tenant" | "conversationId" | "turn">
): string {
  return `ticket-${request.tenant}-${request.conversationId}-${request.turn}`;
}

export async function createTicket(
  client: InvokeAsyncCapableClient,
  config: ScorerConfig,
  request: CreateTicketRequest
): Promise<CreateTicketResult> {
  const idempotencyKey = buildTicketIdempotencyKey(request);
  const webhookUrl = `${config.selfInternalBaseUrl}/webhooks/invoke`;

  log(
    `create-ticket: tenant=${request.tenant} conversationId=${request.conversationId} turn=${request.turn} idempotencyKey=${idempotencyKey} webhook=${webhookUrl}`
  );

  const { invocationId } = await client.connectors.invoke(
    config.hubspotConnectorId,
    config.hubspotCreateTicketEndpointId,
    { method: "POST", data: request.ticket },
    {
      mode: "async",
      idempotencyKey,
      webhook: { url: webhookUrl },
    }
  );

  log(`create-ticket: accepted invocationId=${invocationId}`);
  return { invocationId, idempotencyKey };
}
