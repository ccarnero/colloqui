/**
 * Request/response types for the `webhooks` resource, hand-typed against the
 * REAL gateway shapes (verified 2026-07-04, see sdk/GROWTH-PLAN.md Phase 2):
 *
 * - `services/api-gateway/src/modules/channels/webhooks.controller.ts` — the
 *   only two ingest routes are `POST /webhooks/:channel/:tenantId` and
 *   `POST /webhooks/:channel/:tenantId/:instance`, both `@Public()` +
 *   `@SkipTenant()` (no JWT, tenant comes from the URL, not the
 *   `x-yoizen-tenant` header or hostname). Both return `{ status: "accepted" }`
 *   on success; the controller throws before publishing if the raw body is
 *   missing/empty.
 * - `webhook-ingress-publisher.service.ts` publishes a `WebhookIngressEnvelope`
 *   to NATS JetStream; the account/token itself is NOT verified at this
 *   layer — provider-specific verification (e.g. the http channel's
 *   `x-http-channel-token`) happens downstream in channel-service.
 * - `GET /webhooks/:channel/:tenantId` (Meta `hub.*` verification handshake)
 *   is intentionally NOT wrapped here: it's a provider-specific webhook
 *   subscription handshake, not a generic ingest operation, and returns a
 *   bare `string` challenge rather than JSON.
 *
 * This resource generalizes the pre-Phase-2 http-channel-only ingest flow
 * (`src/infrastructure/ingest-adapter.ts`, used by `send`/`sendText`) into an
 * escape hatch for any channel. It intentionally does NOT reuse
 * `ingest-adapter.ts`'s internals — see `client.ts` for why — so
 * `send`/`sendText` request bytes are provably unchanged.
 */

/** `client.webhooks.ingest()` input. */
export interface WebhookIngestInput {
  /**
   * Tenant to publish under. The webhook ingest route resolves tenant from
   * the URL path (`@SkipTenant()` on the gateway controller), NOT from the
   * transport's default `x-yoizen-tenant` header, so it must be passed
   * explicitly per call.
   */
  tenant: string;
  /** Channel identifier segment of the URL, e.g. `"http"`, `"whatsapp"`, `"telegram"`, `"instagram"`. */
  channel: string;
  /**
   * Optional account `externalId` for instance-addressed ingress
   * (`/webhooks/:channel/:tenantId/:instance`). Omit for the legacy
   * per-tenant path.
   */
  instance?: string;
  /** Raw JSON body forwarded verbatim to channel-service via NATS. */
  body: unknown;
  /**
   * Extra headers forwarded to the endpoint — e.g. the http channel's
   * `x-http-channel-token`, or a provider signature header. Merged with the
   * transport's own headers (tenant, request-id); does not disable auth
   * handling, which is already `false` for this public route.
   */
  headers?: Record<string, string>;
}

/** Response shape for both ingest routes (`{ status: string }`). */
export interface WebhookIngestResult {
  status: string;
}
