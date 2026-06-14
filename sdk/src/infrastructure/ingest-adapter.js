import { httpJson } from "./http.js";
import { IngestError } from "../domain/errors.js";

/** Per-account shared secret header for the http channel. */
const CHANNEL_TOKEN_HEADER = "x-http-channel-token";

/**
 * IngestPort implementation. POSTs the message to the public http-channel webhook and
 * maps the result: only `status === "accepted"` succeeds; every other status (which the
 * platform returns inside a 200 body) becomes an `IngestError` carrying `ingestStatus`.
 *
 * @param {{ fetchImpl: typeof fetch, baseUrl: string, timeoutMs: number }} deps
 * @returns {import("../application/ports.js").IngestPort}
 */
export function createIngestAdapter({ fetchImpl, baseUrl, timeoutMs }) {
  async function ingest({ tenant, appSecret, body }) {
    const { status, ok, body: resBody } = await httpJson(fetchImpl, {
      url: `${baseUrl}/api/webhooks/http/${encodeURIComponent(tenant)}`,
      method: "POST",
      headers: { [CHANNEL_TOKEN_HEADER]: appSecret },
      body,
      timeoutMs,
    });

    if (!ok) {
      throw new IngestError("ingest request failed", {
        details: { httpStatus: status, body: resBody },
      });
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
      accountId: resBody.accountId,
      messageId: resBody.messageId,
    };
  }

  return { ingest };
}
