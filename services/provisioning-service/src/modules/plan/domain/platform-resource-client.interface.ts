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
   */
  findByName(
    tenantId: string,
    name: string
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
