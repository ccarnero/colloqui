// Pure key builder for the invocation result-parking Redis record
// (`manual-loops/connector-invoke-api.md` T05).
//
// TENANT SCOPING DECISION (T05, per SPEC's "an invocation must not be
// readable by another tenant" constraint): tenant is embedded IN the key
// (`invocation:<tenantId>:<invocationId>`), not just in the stored value.
// This means a cross-tenant GET (tenant header X requesting an invocation
// created under tenant Y) is a Redis cache-miss by construction — no
// separate "does the stored tenant match the caller" check can ever be
// forgotten because there is nothing to look up. Mirrors the tenant-scoped
// key convention `@yoizen/shared`'s `PENDING_KEY_PREFIX`/`RESULT_KEY_PREFIX`
// already establish (`pending:<tenant>:<id>`-shaped keys elsewhere in the
// platform) — see `packages/shared/src/constants.ts`.
export function buildInvocationRedisKey(
  tenantId: string,
  invocationId: string
): string {
  return `invocation:${tenantId}:${invocationId}`;
}
