// Port the resolver calls to read live platform state. Implementations live
// in `../infrastructure/` and talk to the existing internal service APIs
// (channels, connectors, agents, registry-service, workflows) — the
// reconciler never touches another service's tables directly.
//
// `findByName` is READ-ONLY by contract: T03's planner must never mutate
// anything. `fields` is a normalized projection of the live resource's
// comparable properties (never secret VALUES), keyed to match the manifest's
// own desired-fields shape for that resource kind so `diffResource` can
// compare them directly.

import type { ResourceKind } from "./plan.interfaces";

export interface LivePlatformResource {
  readonly externalId: string;
  readonly fields: Readonly<Record<string, unknown>>;
  /**
   * Optional escape hatch for kind-specific RAW data a `build-manifest-
   * plan.ts` branch needs beyond the generic `fields` projection —
   * currently only `registry-services-client.ts` sets this (the raw
   * `RegisteredServiceDto`, so `build-manifest-plan.ts`'s service branch can
   * re-project env mechanism using the plan-time `resolvedIds` this client
   * has no access to; manual-loops/demos/crm-support-telegram.md T04 findings).
   * NEVER read by `diffResource` — `fields` remains the ONLY diffed
   * projection, so `raw` can never leak into the serialized plan by itself.
   */
  readonly raw?: unknown;
}

export interface DownstreamError {
  readonly kind: "downstream_error";
  readonly resourceKind: ResourceKind;
  readonly resourceName: string;
  readonly message: string;
}

export interface IPlatformResourceClient {
  /**
   * Looks up the live resource named `name` for `tenantId`.
   * Resolves to `null` when no such resource exists yet (→ `create`).
   * Never throws — downstream failures surface as a typed `DownstreamError`.
   *
   * `declaredResource` (T05, gap 5) is the manifest's OWN desired shape for
   * this resource, when the caller has it — `registry-services-client.ts`
   * uses it so `serviceComparable.fromLive` only compares an optional
   * scaling field (port/minScale/maxScale/concurrencyTarget) when the
   * manifest actually DECLARES it, never inventing a comparison against a
   * server-side default the manifest never asked about (decision 6). Every
   * other client ignores this parameter.
   */
  findByName(
    tenantId: string,
    name: string,
    declaredResource?: unknown
  ): Promise<
    | { ok: true; value: LivePlatformResource | null }
    | { ok: false; error: DownstreamError }
  >;
}

/** One injectable client per manifest section, keyed by `ResourceKind`. */
export type PlatformResourceClients = Readonly<
  Record<ResourceKind, IPlatformResourceClient>
>;

export const PLATFORM_RESOURCE_CLIENTS = Symbol("PLATFORM_RESOURCE_CLIENTS");
