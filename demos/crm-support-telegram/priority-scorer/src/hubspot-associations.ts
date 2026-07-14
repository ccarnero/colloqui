/**
 * Fetches associated HubSpot object ids (deals or tickets) for one contact,
 * via a SYNC `connectors.invoke()` call against the `demo-hubspot` connector
 * (provisioned by `../src/02-hubspot-connector.ts`, T03). Wraps the call in
 * an `AssociationFetchResult` (`./score.ts`) so `computeScore()` never has to
 * deal with exceptions.
 *
 * NOTE (SDK gap, same as `02-hubspot-connector.ts`): the SDK does not
 * re-export `connectors.invoke()`'s result types, so the minimal shape is
 * mirrored locally here instead of reaching into the resource's internal
 * types or patching the SDK (out of scope for this loop).
 */
import type { AssociationFetchResult } from "./score.js";

export interface InvokeCapableClient {
  connectors: {
    invoke(
      connectorId: string,
      endpointId: string,
      args: { method: string; data?: unknown }
    ): Promise<{
      invocationId: string;
      status: number;
      data: unknown;
      headers: Record<string, string>;
      cacheResult?: "hit" | "miss" | "bypass" | null;
    }>;
  };
}

// HubSpot v3 associations batch/read response shape (verified against the
// same route T03 provisioned): { results: [{ from: { id }, to: [{ id, type }] }] }.
// Only ids are read — see the data-availability gap note in `./score.ts`.
interface AssociationsBatchReadResponse {
  results?: Array<{
    from?: { id?: string };
    to?: Array<{ id?: string; toObjectId?: string }>;
  }>;
}

function extractAssociatedIds(data: unknown): string[] {
  const body = data as AssociationsBatchReadResponse | undefined;
  if (!body?.results) {
    return [];
  }
  const ids: string[] = [];
  for (const result of body.results) {
    for (const to of result.to ?? []) {
      const id = to.id ?? to.toObjectId;
      if (id) {
        ids.push(id);
      }
    }
  }
  return ids;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Invokes an associations batch/read endpoint (`list-deals-by-contact` or
 * `list-tickets-by-contact`) for one HubSpot contact id. Catches BOTH
 * gateway-level failures (thrown `SdkError`, e.g. circuit breaker open) and
 * downstream HubSpot HTTP errors (`result.status !== 200`) — both surface as
 * `{ ok: false }` so the caller degrades the score instead of crashing.
 */
export async function fetchAssociatedIds(
  client: InvokeCapableClient,
  connectorId: string,
  endpointId: string,
  contactId: string
): Promise<AssociationFetchResult> {
  try {
    const result = await client.connectors.invoke(connectorId, endpointId, {
      method: "POST",
      data: { inputs: [{ id: contactId }] },
    });
    if (result.status !== 200) {
      return {
        ok: false,
        ids: [],
        error: `hubspot-http-${result.status}`,
      };
    }
    return { ok: true, ids: extractAssociatedIds(result.data) };
  } catch (e) {
    return { ok: false, ids: [], error: messageOf(e) };
  }
}
