// Port the apply engine calls to create-or-update live platform resources.
// Implementations live in `../infrastructure/` and talk to the existing
// internal service APIs — the reconciler never writes to another service's
// tables directly (SPEC.md constraint).
//
// Mirrors `IPlatformResourceClient` (T03's read-only port) but for WRITES.
// Kept as a separate interface so the T03 planner's read-only contract is
// never weakened by adding mutation methods to it.

import type { ResourceKind } from "../../plan/domain/plan.interfaces";
import type { AnyManifestResource } from "../../plan/lib/list-manifest-resources";
import type { ApplyWriteError } from "./apply.interfaces";

export type CreateOrUpdateResult =
  | { readonly ok: true; readonly value: { readonly externalId: string } }
  | { readonly ok: false; readonly error: ApplyWriteError };

export interface IPlatformResourceWriter {
  /**
   * Creates the resource from its manifest shape. Never fabricates secret
   * values — resources whose manifest entry declares a `secretRef` (or an
   * env var `secretRef`) resolve to a typed `secret_not_resolvable` error
   * until the T05 secrets broker lands.
   */
  create(
    tenantId: string,
    resource: AnyManifestResource
  ): Promise<CreateOrUpdateResult>;

  /**
   * Updates ONLY the mappable fields present in `diff` (the T03 comparable-
   * fields contract may report a diff field with no corresponding writable
   * API field — e.g. a channel's `type` — in which case this is a safe
   * no-op that still resolves `ok` with the existing `externalId`).
   */
  update(
    tenantId: string,
    externalId: string,
    resource: AnyManifestResource,
    diff: readonly { readonly field: string }[]
  ): Promise<CreateOrUpdateResult>;
}

/** One injectable writer per manifest section, keyed by `ResourceKind`. */
export type PlatformResourceWriters = Readonly<
  Record<ResourceKind, IPlatformResourceWriter>
>;

export const PLATFORM_RESOURCE_WRITERS = Symbol("PLATFORM_RESOURCE_WRITERS");
