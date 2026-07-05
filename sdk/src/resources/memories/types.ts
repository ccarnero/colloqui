/**
 * Request/response types for the `memories` resource, hand-typed against the
 * REAL gateway + downstream shapes (verified 2026-07-04, see
 * sdk/GROWTH-PLAN.md Phase 2 priority 6):
 *
 * - `services/api-gateway/src/modules/admin/admin-memories.controller.ts`
 *   (+ `admin.dto.ts`) proxies via `AgentMemoryProxyService` to
 *   **`agent-memory-service`** (`gatewayConfig.services.agentMemory`) — NOT
 *   `agent-admin-service`.
 * - `services/agent-memory-service/src/modules/memory/controllers/
 *   admin-memories.controller.ts` + `.../domain/memory.entity.ts`
 *   (`IMemory`) + `.../services/memory.service.ts` define the real DTOs and
 *   response envelope.
 *
 * IMPORTANT — do not confuse with a second, unrelated controller at
 * `services/agent-admin-service/src/modules/memories/memories.controller.ts`
 * (`MemoriesController`), which happens to share the same `admin/memories`
 * path but is registered in a DIFFERENT service. The gateway's proxy
 * (`AgentMemoryProxyService`) never calls it — that controller appears to be
 * orphaned/legacy code, not exercised by any gateway route. This resource's
 * types are derived exclusively from the live `agent-memory-service`
 * controller.
 *
 * Known gaps:
 * - `POST /admin/memories` — the gateway's `CreateMemoryDto.title` is
 *   `@IsOptional()`, but the downstream `ProposeMemoryDto.title` is
 *   `@IsNotEmpty()` (required, max 500 chars). Omitting `title` passes
 *   gateway validation and 400s downstream. Typed as required here to match
 *   the real (downstream) contract, matching the pattern already used in
 *   `connectors.baseUrl`.
 * - `PATCH /admin/memories/:id` — the gateway's `UpdateMemoryDto` accepts a
 *   `topicKey` field (enforced via a custom `@AtLeastOneField` validator
 *   requiring at least one field), but the downstream update DTO has NO
 *   `topicKey` field at all — it is silently dropped (downstream's
 *   `ValidationPipe` strips unknown properties). Included here for
 *   completeness (it IS accepted gateway-side) but documented as a no-op.
 * - `GET /admin/memories` — the gateway's list DTO accepts a `context`
 *   query filter that the downstream `MemoryQueryDto` does NOT define; it is
 *   silently ignored downstream. Not exposed here to avoid encoding a
 *   filter that has no effect.
 * - `GET /admin/memories/proposals` forwards only `scope`/`kind`/`search`/
 *   `limit`/`offset` — the downstream handler forces `status: PROPOSED`
 *   server-side regardless of any `status` the caller might try to pass.
 * - `PATCH /admin/memories/:id/approve` and `.../reject` 404 (not 409) when
 *   the memory's current `status` isn't `PROPOSED`.
 */

export type MemoryScope = "SESSION" | "USER" | "TENANT";
export type MemoryKind =
  | "PREFERENCE"
  | "FACT"
  | "NOTICE"
  | "INCIDENT"
  | "PROMO";
export type MemoryStatus =
  | "PROPOSED"
  | "ACTIVE"
  | "PUBLISHED"
  | "REJECTED"
  | "EXPIRED"
  | "ARCHIVED";

export interface Memory {
  id: string;
  tenantId: string;
  userId?: string;
  sessionId?: string;
  scope: MemoryScope;
  kind: MemoryKind;
  status: MemoryStatus;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  topicKey?: string;
  /** ISO-8601 timestamp, when set. */
  expiresAt?: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp. */
  updatedAt: string;
}

export interface ListMemoriesParams {
  scope?: MemoryScope;
  kind?: MemoryKind;
  status?: MemoryStatus;
  search?: string;
  limit?: number;
  offset?: number;
  includeExpired?: boolean;
  sessionId?: string;
  userId?: string;
}

/** `GET /admin/memories/proposals` — only these fields are actually forwarded downstream; `status` is always forced to `PROPOSED`. */
export interface ListMemoryProposalsParams {
  scope?: MemoryScope;
  kind?: MemoryKind;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * `POST /admin/memories` body. `title` is typed required here to match the
 * downstream (real) contract — see the gap note above.
 */
export interface CreateMemoryInput {
  scope: MemoryScope;
  kind: MemoryKind;
  /** Required downstream despite being optional in the gateway's own DTO. Max 500 chars. */
  title: string;
  /** Max 50,000 chars. */
  content: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  topicKey?: string;
  ttl?: number;
}

/**
 * `PATCH /admin/memories/:id` body. `topicKey` is accepted gateway-side but
 * silently dropped downstream — see the gap note above.
 */
export interface UpdateMemoryInput {
  title?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  /** Accepted by the gateway's DTO but has no effect downstream — see `types.ts`. */
  topicKey?: string;
}
