// Port `buildManifestPlan` uses to verify a referenced secret binding
// actually exists as a real k8s Secret key (T05: real-Secret verification
// replaces T04's "always missing" placeholder). Kept as a narrow read-only
// port (existence only, never a value) so the planner's read-only contract
// is never weakened — mirrors `IPlatformResourceClient`'s shape.

import type { ResourceKind } from "./plan.interfaces";

export interface SecretExistenceChecker {
  /** Never resolves the value — existence only. */
  exists(
    tenantId: string,
    kind: ResourceKind,
    owner: string,
    secretName: string
  ): Promise<
    | { readonly ok: true; readonly value: boolean }
    | { readonly ok: false; readonly error: string }
  >;
}

/**
 * Default used when no checker is injected (unit tests exercising
 * `buildManifestPlan` directly, and T04's pre-T05 behavior): every
 * referenced secret is reported missing, exactly like the T04 placeholder.
 */
export const NOOP_SECRET_EXISTENCE_CHECKER: SecretExistenceChecker = {
  async exists() {
    return { ok: true, value: false };
  },
};

export const SECRET_EXISTENCE_CHECKER = Symbol("SECRET_EXISTENCE_CHECKER");
