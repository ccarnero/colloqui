import type { Transport } from "../../core/transport.js";
import type { WebhookIngestInput, WebhookIngestResult } from "./types.js";

export interface WebhooksClientDeps {
  transport: Transport;
}

export interface WebhooksClient {
  /**
   * `POST /webhooks/:channel/:tenantId[/:instance]` — generic webhook
   * ingress escape hatch for any channel, not just `http`. Deliberately NOT
   * built by refactoring `src/infrastructure/ingest-adapter.ts` (the
   * `send`/`sendText` adapter): the two have different auth models (the
   * adapter always sends the fixed `x-http-channel-token` header and never
   * lets the caller override it; this method accepts arbitrary caller
   * headers for any provider), and duplicating the ~5-line path-building
   * logic here carries zero regression risk to the byte-compatible
   * `send`/`sendText` contract that `test/infrastructure/ingest-adapter.test.ts`
   * and `test/e2e/http-ingest.e2e.ts` pin down. Both call sites converge on
   * the same `Transport`, so headers/tenant/retry policy still come from one
   * place.
   */
  ingest(input: WebhookIngestInput): Promise<WebhookIngestResult>;
}

/**
 * Creates the `webhooks` namespace client. See sdk/README.md "Resource
 * clients" for the pattern this follows (from the `workflows` reference
 * implementation).
 */
export function createWebhooksClient({
  transport,
}: WebhooksClientDeps): WebhooksClient {
  async function ingest(
    input: WebhookIngestInput
  ): Promise<WebhookIngestResult> {
    const base = `/webhooks/${encodeURIComponent(input.channel)}/${encodeURIComponent(input.tenant)}`;
    const path =
      typeof input.instance === "string" && input.instance.length > 0
        ? `${base}/${encodeURIComponent(input.instance)}`
        : base;

    const { body } = await transport.request<WebhookIngestResult>({
      path,
      method: "POST",
      headers: input.headers,
      body: input.body,
      tenant: input.tenant,
      auth: false,
    });
    return body;
  }

  return { ingest };
}
