/**
 * Request/response types for the `registry` resource, hand-typed against the
 * REAL gateway + downstream shapes (verified 2026-07-04, see
 * sdk/GROWTH-PLAN.md Phase 2 priority 5):
 *
 * - `services/api-gateway/src/modules/registry/registry.controller.ts` +
 *   `registry.dto.ts` define the gateway-side routes and validation
 *   (`RegistryProxyService` forwards verbatim JSON to `registry-service`).
 * - `services/registry-service/src/modules/services/{services.controller,
 *   services.service,services.dto}.ts` define service registration, Knative
 *   lifecycle, and revisions.
 * - `services/registry-service/src/modules/canary/{canary.controller,
 *   canary.service,canary.dto}.ts` define canary start/update/promote/
 *   rollback/status.
 * - `services/registry-service/src/modules/routes/{routes.controller,
 *   routes.service,routes.dto}.ts` define per-service route CRUD and the
 *   root discovery endpoint.
 * - `services/registry-service/src/common/registry-row-mappers.ts` owns the
 *   row -> API model mapping (`IRegisteredService`, `IServiceRoute`,
 *   `ICanaryStatus`).
 *
 * CAUTION (hard invariant from GROWTH-PLAN.md): `registry.routes` feed the
 * api-gateway's dynamic router, which polls `GET /routes` every 15s and
 * proxies any non-platform-prefix path matching a registered `pathPrefix` to
 * the corresponding tenant Knative service. Creating a route with a broad or
 * colliding `pathPrefix` can shadow real platform routes cluster-wide for
 * ALL tenants (routes are not tenant-isolated at the proxy layer — only
 * `service_routes` rows are tenant-scoped, but the live proxy table is
 * global). Callers MUST use obviously-fake, narrow, collision-safe prefixes
 * and MUST always delete what they register, even on failure.
 *
 * Known gap: the gateway's `RegistryController.discoverRoutes()` DOES proxy
 * `GET /registry/routes` (root discovery, `@SkipTenant()`) — it is not
 * internal-only. Implemented here as `discoverRoutes()`, but treat it as a
 * read-only introspection escape hatch, not a routing management primitive.
 *
 * Behavioral notes (not gaps, but load-bearing for callers):
 * - `canary.getStatus()` (`GET /registry/services/:id/canary`) returns
 *   `null` (HTTP 200) when no canary deployment row exists for the service —
 *   not a 404.
 * - `canary.start()` requires the service to have an active Knative
 *   deployment and 400s (`BadRequestException` -> generic `SdkError`,
 *   `code: "HTTP"`) if one is already progressing or none exists.
 * - Canary operations mutate live Knative traffic splitting for the target
 *   service's revisions; they are NOT safe to run against a service without
 *   a real Knative deployment (see e2e test notes).
 *
 * KNOWN DOWNSTREAM BUG (verified live 2026-07-04, reproduced via SDK e2e):
 * `ServicesService.update()` (`services.service.ts` `updateKnativeService`)
 * does a read-then-replace of the Knative Service custom object with NO
 * retry on a K8s optimistic-concurrency 409 ("the object has been modified;
 * please apply your changes to the latest version"). Knative's own
 * reconciler frequently bumps `resourceVersion` (status fields) within the
 * first couple of seconds after `register()` creates the object, so an
 * `update()` issued immediately after `create()` can lose that race and
 * surface as a generic 500 (`code: "HTTP"`, `details.body.message` contains
 * "Conflict").
 *
 * SERVER-SIDE FIX PENDING DEPLOY: `registry-service`'s `update()` now
 * retries 409 conflicts internally (bounded 5-attempt GET-mutate-PUT retry
 * loop), so a fixed cluster should no longer surface this race to callers.
 * That fix lives in the `services/registry-service` working tree as of
 * 2026-07-05 but has NOT been confirmed live against the dev cluster.
 * `test/e2e/connectors-registry.e2e.ts` keeps its client-side
 * `withKnativeConflictRetry` backoff workaround until the server-side fix is
 * confirmed deployed — callers of `services.update()` right after
 * `services.create()` should still expect and retry this transient conflict
 * until then.
 */

export type RouteMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

/** `POST /registry/services` body (mirrors `RegisterServiceDto`). */
export interface RegisterServiceInput {
  /** Lowercase alphanumeric with optional hyphens, max 63 chars (Knative-safe DNS label). */
  name: string;
  image: string;
  port?: number;
  minScale?: number;
  maxScale?: number;
  concurrencyTarget?: number;
  envVars?: Record<string, string>;
}

/** `PATCH /registry/services/:id` body (mirrors `UpdateServiceDto`). */
export interface UpdateServiceInput {
  image?: string;
  port?: number;
  minScale?: number;
  maxScale?: number;
  concurrencyTarget?: number;
  envVars?: Record<string, string>;
}

/** Response shape for service register/list/update (`IRegisteredService`). */
export interface RegisteredService {
  id: string;
  tenantId: string;
  name: string;
  image: string;
  port: number;
  minScale: number;
  maxScale: number;
  concurrencyTarget: number;
  envVars: Record<string, string>;
  status: string;
  knativeName: string | null;
  namespace: string | null;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp. */
  updatedAt: string;
}

/** `GET /registry/services/:id` response — adds live Knative status when deployed. */
export interface RegisteredServiceDetail extends RegisteredService {
  knativeStatus?: Record<string, unknown>;
}

/** One row of `GET /registry/services/:id/revisions` (`IRevisionInfo`). */
export interface ServiceRevision {
  name: string;
  ready: boolean;
  /** ISO-8601 timestamp, empty string if unavailable. */
  createdAt: string;
  image: string;
}

/** `POST /registry/services/:id/canary` body (mirrors `StartCanaryDto`). */
export interface StartCanaryInput {
  image: string;
  /** 1-100. */
  percent: number;
}

/** `PATCH /registry/services/:id/canary` body (mirrors `UpdateCanaryDto`). */
export interface UpdateCanaryInput {
  /** 0-100. */
  percent: number;
}

/** Response shape for canary start/update/promote/rollback/status (`ICanaryStatus`). */
export interface CanaryStatus {
  id: string;
  serviceId: string;
  stableRevision: string;
  canaryRevision: string;
  canaryPercent: number;
  status: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp. */
  updatedAt: string;
}

/**
 * `POST /registry/services/:id/routes` body (mirrors `CreateRouteDto`).
 * See the CAUTION note in this file's header comment before creating routes
 * against a live cluster.
 */
export interface CreateRouteInput {
  /** Must start with `/`. */
  pathPrefix: string;
  /** Defaults to all methods (`GET,POST,PUT,PATCH,DELETE`) when omitted. */
  methods?: RouteMethod[];
  /** Defaults to `false` — bypasses `AuthGuard`/`TenantGuard` at the gateway proxy layer when `true`. */
  isPublic?: boolean;
  /** Defaults to `true` — strips `pathPrefix` before forwarding upstream. */
  stripPrefix?: boolean;
}

/** Response shape for route create/list (`IServiceRoute`). */
export interface ServiceRoute {
  id: string;
  serviceId: string;
  pathPrefix: string;
  methods: string[];
  isPublic: boolean;
  stripPrefix: boolean;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

/**
 * One row of `GET /registry/routes` (root discovery, `IRouteDiscoveryEntry`)
 * — the exact shape the gateway's dynamic route cache polls every 15s.
 */
export interface DiscoveredRoute {
  id: string;
  tenantId: string;
  serviceName: string;
  knativeName: string;
  namespace: string;
  /** Always `80` — Knative's cluster-local Service DNS entry, not the user container's port. */
  port: number;
  pathPrefix: string;
  methods: string[];
  isPublic: boolean;
  stripPrefix: boolean;
}
