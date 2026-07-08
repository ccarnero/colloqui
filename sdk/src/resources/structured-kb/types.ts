/**
 * Request/response types for the `structuredKb` resource, hand-typed against
 * the REAL gateway + downstream shapes (verified 2026-07-04, see
 * sdk/GROWTH-PLAN.md Phase 2 priority 6):
 *
 * - `services/api-gateway/src/modules/admin/admin-structured-kb.controller.ts`
 *   proxies container CRUD via `AdminProxyService` to `agent-admin-service`.
 * - `services/agent-admin-service/src/modules/structured-kb/
 *   containers.controller.ts` (`SKBContainersController`) +
 *   `types/skb.types.ts` (`SKBContainerRow`) define container CRUD.
 * - `services/agent-admin-service/src/modules/structured-kb/
 *   structured-kb.controller.ts` (`StructuredKBController`) defines the
 *   `containers/:id/query` endpoint + its rate-limit guard.
 *
 * `POST /admin/structured-kb/containers/:id/query` (`StructuredKBController.query`,
 * guarded by `SKBRateLimitGuard`: 30 requests/min per tenant, in-memory
 * sliding window; translates a natural-language `query` into SQL via an LLM,
 * `SKBQueryService.query`) is now proxied by the gateway's
 * `AdminStructuredKBController` (`@Post("containers/:id/query")`, body typed
 * as `QueryStructuredKbDto`). As of 2026-07-05 this gateway route exists in
 * source but the dev cluster's running pod still 404s ("Cannot POST
 * .../query") — the fix is not yet hot-reloaded/deployed. See
 * `containers.query()`.
 *
 * `POST /admin/structured-kb/containers/:id/files`
 * (`SKBContainersController.uploadFile`, `UploadSKBFileDto`) creates the
 * `skb_files` row (status `"pending"`) and publishes the ingestion event
 * consumed by `SKBIngestionWorkerService` — fire-and-forget from the
 * caller's perspective, same create-then-publish shape as
 * `DocumentsController.uploadFile()`. Returns `202 Accepted` with
 * `{ fileId, status }`, not the full container/file record. See
 * `containers.uploadFile()`.
 *
 * Other gaps:
 * - `DELETE /admin/structured-kb/containers/:id`: downstream returns 204,
 *   but `AdminProxyService.proxy()` converts a 204 into an HTTP 200 with an
 *   empty-object body at the gateway — `remove()` expects 200, not 204.
 * - `GET /admin/structured-kb/containers` is a BARE ARRAY (no pagination
 *   envelope) — degraded to a single page via `toSinglePage()`.
 */

export type SKBContainerStatus = "active" | "inactive" | "error";

export interface SKBContainer {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  status: SKBContainerStatus;
  version: string;
  ingest_model: string;
  query_model: string;
  provider_config: Record<string, unknown>;
  is_active: boolean;
  /** ISO-8601 timestamp. */
  created_at: string;
  /** ISO-8601 timestamp. */
  updated_at: string;
}

/** `POST /admin/structured-kb/containers` body. */
export interface CreateSKBContainerInput {
  name: string;
  description?: string;
}

/** `PATCH /admin/structured-kb/containers/:id` body. */
export interface UpdateSKBContainerInput {
  name?: string;
  description?: string;
}

/**
 * `POST /admin/structured-kb/containers/:id/query` body
 * (`QueryStructuredKbDto`, mirrors agent-admin-service's `QuerySKBDto`).
 */
export interface QuerySKBContainerInput {
  /** Natural-language query, translated to SQL by an LLM downstream. */
  query: string;
  categories?: string[];
  /** 1-1000, downstream-enforced. */
  limit?: number;
  offset?: number;
}

/**
 * Response shape for `POST /admin/structured-kb/containers/:id/query`
 * (`QueryResult` in `agent-admin-service`'s `skb-query.service.ts`).
 */
export interface QuerySKBContainerResult {
  results: Record<string, unknown>[];
  sql: string;
  totalCount: number;
}

/**
 * `POST /admin/structured-kb/containers/:id/files` body (mirrors
 * `UploadSKBFileDto`). `fileBase64` maps to the DTO's `file_base64` and
 * `sheetName` to `sheet_name` — camelCase at the SDK boundary, same
 * convention as the rest of this resource's types.
 */
export interface UploadSKBFileInput {
  filename: string;
  fileBase64: string;
  categories?: string[];
  sheetName?: string;
}

/**
 * `POST /admin/structured-kb/containers/:id/files` response — `202
 * Accepted`. Ingestion runs async (NATS-driven worker); this only confirms
 * the file row was created and the ingestion event published.
 */
export interface UploadSKBFileResult {
  fileId: string;
  status: string;
}
