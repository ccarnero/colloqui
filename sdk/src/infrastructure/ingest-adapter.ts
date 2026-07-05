import type { IngestPort } from "../application/ports.js";
import type { Transport } from "../core/transport.js";
import { IngestError } from "../domain/errors.js";

/** Per-account shared secret header for the http channel. */
const CHANNEL_TOKEN_HEADER = "x-http-channel-token";

export interface IngestAdapterDeps {
  transport: Transport;
}

interface IngestResponseBody {
  status?: string;
  accountId?: string;
  messageId?: string;
}

/**
 * IngestPort implementation over the shared {@link Transport}. POSTs the
 * message to the public http-channel webhook. This endpoint authenticates
 * via the per-account `x-http-channel-token` header, not a session bearer
 * token, so every call is made with `auth: false` — the transport still
 * contributes the tenant header, timeout, request-id, and retry policy.
 *
 * Only `status === "accepted"` succeeds; every other status (which the
 * platform returns inside a 200 body) becomes an `IngestError` carrying
 * `ingestStatus`. Any transport-level failure (non-2xx, network) is also
 * normalized to `IngestError` to preserve the pre-transport contract.
 */
export function createIngestAdapter({
  transport,
}: IngestAdapterDeps): IngestPort {
  async function ingest({
    tenant,
    appSecret,
    body,
    instance,
  }: {
    tenant: string;
    appSecret: string;
    body: Record<string, unknown>;
    instance?: string | null;
  }) {
    // Instance-addressed path when the account externalId is known
    // (`/webhooks/http/<tenant>/<instance>`); otherwise the legacy
    // per-tenant path (token-only routing). The token header is sent either way.
    const base = `/webhooks/http/${encodeURIComponent(tenant)}`;
    const path =
      typeof instance === "string" && instance.length > 0
        ? `${base}/${encodeURIComponent(instance)}`
        : base;

    let resBody: IngestResponseBody | undefined;
    try {
      const result = await transport.request<IngestResponseBody>({
        path,
        method: "POST",
        headers: { [CHANNEL_TOKEN_HEADER]: appSecret },
        body,
        tenant,
        auth: false,
      });
      resBody = result.body;
    } catch (err) {
      if (err instanceof IngestError) {
        throw err;
      }
      throw new IngestError("ingest request failed", { cause: err });
    }

    const ingestStatus = resBody?.status;
    if (ingestStatus !== "accepted") {
      throw new IngestError(`ingest rejected: ${ingestStatus ?? "unknown"}`, {
        ingestStatus: ingestStatus ?? "unknown",
        details: { body: resBody },
      });
    }

    return {
      status: "accepted",
      accountId: resBody!.accountId,
      messageId: resBody!.messageId,
    };
  }

  return { ingest };
}
