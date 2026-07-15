// Port for the ONE k8s Secret-per-resource store (SPEC.md decision 4).
// Implementations live in `../infrastructure/`. This is the ONLY place in
// the service that ever reads a secret VALUE off the cluster — every value
// that crosses this boundary is treated as ephemeral by its callers
// (`SecretsBrokerService`) and NEVER logged, cached, or persisted to
// Postgres.
//
// `readResourceSecret` returns the FULL key/value map of the resource's
// Secret object (never a single value) because SPEC.md's per-resource model
// allows multiple named secrets to be bound to the same (kind, owner) pair
// (e.g. a connector needing both `apiKey` and `apiSecret`) — they all live
// as separate keys inside the ONE k8s Secret object for that resource. The
// caller (broker) picks the single key it needs and discards the rest
// in-memory; `readResourceSecret` itself never logs the map.

import type { ResourceKind } from "../../plan/domain/plan.interfaces";

export interface SecretBindingSummary {
  readonly name: string;
  readonly scope: { readonly kind: ResourceKind; readonly owner: string };
}

export type SecretsStoreErrorKind = "downstream_error" | "invalid_name";

export interface SecretsStoreError {
  readonly kind: SecretsStoreErrorKind;
  readonly message: string;
}

export interface ISecretsStore {
  /**
   * Creates or updates ONE key (`name`) inside the per-resource k8s Secret
   * `psec-<kind>-<owner>`. Existing keys for OTHER secret names bound to the
   * same resource are preserved (merge, never overwrite the whole object).
   */
  write(
    tenantId: string,
    name: string,
    value: string,
    scope: { readonly kind: ResourceKind; readonly owner: string }
  ): Promise<
    | { readonly ok: true }
    | { readonly ok: false; readonly error: SecretsStoreError }
  >;

  /**
   * Lists every secret NAME + BINDING (kind/owner) known for this tenant —
   * NEVER a value. Derived from the k8s Secret objects' labels (scope) and
   * `data` keys (names) — no separate metadata store, so there is nowhere
   * else a value could accidentally leak from.
   */
  list(
    tenantId: string
  ): Promise<
    | { readonly ok: true; readonly value: readonly SecretBindingSummary[] }
    | { readonly ok: false; readonly error: SecretsStoreError }
  >;

  /**
   * Reads the full key/value map of the resource's Secret object, or `null`
   * if no Secret exists yet for this (kind, owner). Callers MUST treat the
   * returned values as ephemeral (never logged/persisted).
   */
  readResourceSecret(
    tenantId: string,
    kind: ResourceKind,
    owner: string
  ): Promise<
    | { readonly ok: true; readonly value: ReadonlyMap<string, string> | null }
    | { readonly ok: false; readonly error: SecretsStoreError }
  >;
}

export const SECRETS_STORE = Symbol("SECRETS_STORE");
