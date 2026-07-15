/**
 * `@yoizen/platform-sdk/secrets` — the `secrets` resource client. See
 * sdk/README.md "Resource clients" for the pattern this follows (from the
 * `connectors` reference implementation, SPEC.md
 * `manual-loops/declarative-provisioning.md` T08).
 */

export type {
  SecretCallOptions,
  SecretsClient,
  SecretsClientDeps,
} from "./client.js";
export { createSecretsClient } from "./client.js";
export type {
  SecretBinding,
  SecretScope,
  SecretScopeKind,
  SecretWriteResult,
} from "./types.js";
