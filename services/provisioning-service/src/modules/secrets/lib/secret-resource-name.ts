// Pure naming helper — the ONLY k8s Secret name a manifest resource's
// bound secrets ever live under (SPEC.md decision 4: ONE k8s Secret PER
// RESOURCE, never a per-tenant bag). Multiple named secrets bound to the
// SAME resource (e.g. a connector needing both `apiKey` and `apiSecret`)
// live as separate KEYS inside this one Secret object's `data` map — see
// `secrets-store.interface.ts` for the read/write contract that relies on
// this.

import type { ResourceKind } from "../../plan/domain/plan.interfaces";

/**
 * `psec-<kind>-<owner>` — deterministic, never includes a secret VALUE. This
 * is the ONE source of truth for the k8s Secret name; every write, read, and
 * label-selector path composes it through here (never inline), so lowercasing
 * here is enough to keep the write and read paths consistent.
 *
 * The kind token is lowercased (manual-loops/provisioning-manifest-gaps-2.md
 * T07): a k8s `metadata.name` must be an RFC 1123 subdomain (lowercase
 * alphanumeric + `-`/`.`). Every ResourceKind was lowercase until T06-parent
 * added `mcpServer` (camelCase) — without this, `psec-mcpServer-<owner>` is
 * rejected by the apiserver with a 422. `toLowerCase()` is a NO-OP for the
 * five original kinds (channel/connector/agent/service/workflow), so this is
 * a pure backward-compatible change with zero migration for existing Secrets.
 * The `owner` segment is already RFC 1123-safe: it is always a manifest name
 * validated by `@yoizen/shared`'s `nameSchema`
 * (`/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/`, lowercase-only), so it needs no
 * transform here.
 */
export function secretResourceName(kind: ResourceKind, owner: string): string {
  return `psec-${kind.toLowerCase()}-${owner}`;
}
