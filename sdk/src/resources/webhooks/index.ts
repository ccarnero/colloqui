/**
 * `@yoizen/platform-sdk/webhooks` — the `webhooks` resource client. See
 * sdk/README.md "Resource clients" for the pattern this follows (from the
 * `workflows` reference implementation).
 */

export type {
  WebhooksClient,
  WebhooksClientDeps,
} from "./client.js";
export { createWebhooksClient } from "./client.js";
export type { WebhookIngestInput, WebhookIngestResult } from "./types.js";
