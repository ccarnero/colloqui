/**
 * Request/response types for the `secrets` resource
 * (`manual-loops/declarative-provisioning.md` T08), hand-typed against the
 * REAL gateway + downstream shapes:
 *
 * - Gateway route: `services/api-gateway/src/modules/provisioning/provisioning.controller.ts`
 *   (`PUT /provisioning/secrets/:name` requires the tenant ADMIN scope —
 *   `secrets:write` permission or wildcard `tenant_admin`; `GET
 *   /provisioning/secrets` is tenant-operator level).
 * - Downstream: `services/provisioning-service/src/modules/secrets/secrets.controller.ts`.
 *
 * Write-only guarantee (SPEC.md decision 4 — automatic reviewer rejection if
 * weakened): NO route on this resource ever returns a secret VALUE. `set()`
 * echoes back only `{ name, scope }`; `list()` returns names + bindings
 * only. This client never logs `value` — see `client.ts`.
 */

/**
 * Mirrors `@yoizen/shared`'s `secretScopeKindSchema`
 * (`packages/shared/src/provisioning/manifest.schema.ts`) minus
 * `"systemVariable"` — see `sdk/src/cli/valid-scope-kinds.ts` for why that
 * member is deliberately excluded (added there only for `ResourceKind`
 * plumbing, never for an actual secret-scope binding). `"mcpServer"` added
 * in `manual-loops/provisioning-manifest-gaps.md` T07: mcpServers[]'s
 * `auth`/`headers` fields bind secrets to this owner kind.
 */
export type SecretScopeKind =
  | "channel"
  | "connector"
  | "agent"
  | "service"
  | "mcpServer"
  | "workflow";

export interface SecretScope {
  kind: SecretScopeKind;
  /** Slug-like name of the owning resource within `kind` (validated server-side via `@yoizen/shared`'s `nameSchema`). */
  owner: string;
}

/** `PUT /provisioning/secrets/:name` response — the write-only echo (name + scope only, never the value). */
export interface SecretWriteResult {
  name: string;
  scope: SecretScope;
}

/** One entry of `GET /provisioning/secrets` — names + bindings ONLY, never a value. */
export interface SecretBinding {
  name: string;
  scope: SecretScope;
}
