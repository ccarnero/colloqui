// Port `buildManifestPlan` uses to surface the T05 (gap 5) decision-6 ruling
// (2026-07-16): `registry.routes` are NOT tenant-isolated at the live gateway
// proxy layer (see `sdk/src/resources/registry/types.ts` CAUTION), so a
// manifest-declared route `pathPrefix` that collides with an existing LIVE
// route owned by a DIFFERENT service/tenant must fail loud instead of
// silently shadowing another tenant's route.
//
// `listAll()` is called ONCE per plan run (the ruling's accepted cost: "a
// routes list call during plan") and reused for every declared route across
// every service — never once per route/service, to keep that cost bounded.
// This mirrors `SecretExistenceChecker`'s shape: a narrow read-only port,
// never a mutation.

export interface ExistingRoute {
  readonly pathPrefix: string;
  readonly serviceName: string;
  readonly tenantId: string;
}

export interface RouteCollisionChecker {
  /** Lists every LIVE route across ALL tenants/services (the same global view the gateway's dynamic router polls). */
  listAll(): Promise<
    | { readonly ok: true; readonly value: readonly ExistingRoute[] }
    | { readonly ok: false; readonly error: string }
  >;
}

/**
 * Default used when no checker is injected (unit tests exercising
 * `buildManifestPlan` directly, and any call site that does not wire the
 * real registry-backed checker): reports no known live routes, so no
 * collision is ever detected. This mirrors `ApplyService`'s existing
 * behavior of not wiring `SecretExistenceChecker` either — the ACTUAL
 * enforcement point for this ruling is `registry-services-writer.ts`, which
 * re-verifies independently right before writing.
 */
export const NOOP_ROUTE_COLLISION_CHECKER: RouteCollisionChecker = {
  async listAll() {
    return { ok: true, value: [] };
  },
};

export const ROUTE_COLLISION_CHECKER = Symbol("ROUTE_COLLISION_CHECKER");
