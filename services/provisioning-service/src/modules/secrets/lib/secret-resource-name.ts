// Pure naming helper — the ONLY k8s Secret name a manifest resource's
// bound secrets ever live under (SPEC.md decision 4: ONE k8s Secret PER
// RESOURCE, never a per-tenant bag). Multiple named secrets bound to the
// SAME resource (e.g. a connector needing both `apiKey` and `apiSecret`)
// live as separate KEYS inside this one Secret object's `data` map — see
// `secrets-store.interface.ts` for the read/write contract that relies on
// this.

import type { ResourceKind } from "../../plan/domain/plan.interfaces";

/** `psec-<kind>-<owner>` — deterministic, never includes a secret VALUE. */
export function secretResourceName(kind: ResourceKind, owner: string): string {
  return `psec-${kind}-${owner}`;
}
