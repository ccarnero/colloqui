/**
 * Checks whether an error thrown by postgres.js is a unique_violation
 * (PG error code 23505). Works with both typed and untyped catch blocks.
 */
export function isPostgresUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

/**
 * SQLSTATE codes that mean the pool is permanently broken — the database,
 * role, or password the pool was configured with no longer exists or no
 * longer accepts the cached credentials. Reconnect attempts will keep
 * failing for the same reason, so the pool MUST be discarded (see
 * {@link TenantConnectionManager.evictTenant} and the self-healing
 * branch in `verifyConnectivity`).
 *
 * Held in a `Set<string>` for O(1) membership lookup on the hot probe
 * path (`verifyConnectivity` runs every readiness probe).
 */
const FATAL_POOL_SQLSTATES: ReadonlySet<string> = new Set([
  "3D000", // invalid_catalog_name (database does not exist / was dropped)
  "28000", // invalid_authorization_specification (role missing / revoked)
  "28P01", // invalid_password
  "42704", // undefined_object (e.g. role lookup failed at startup)
]);

/**
 * Substrings that postgres.js / libpq sometimes surface in `error.message`
 * when the underlying SQLSTATE is not propagated (typically: connection
 * setup / authentication failures that error before a server-side STATE
 * is exchanged). Lower-cased once at module load; matched case-insensitively.
 *
 * Conservative on purpose: every entry must be a "permanent for this pool"
 * signal — transient errors like `ECONNREFUSED`, timeouts, or `terminating
 * connection due to administrator command` are intentionally NOT in this
 * list because the pool's reconnect logic resolves them on its own.
 */
const FATAL_POOL_MESSAGE_NEEDLES: readonly string[] = [
  "database \"",
  "role \"",
  "password authentication failed",
];

/**
 * Returns true when the given error indicates the pool's underlying
 * database/role/credentials are no longer valid. Used by
 * {@link TenantConnectionManager.verifyConnectivity} to self-heal: a
 * pool that triggers this predicate is closed and removed from the
 * cache so the next request opens a fresh one (or the cold-start
 * `pools.size === 0` short-circuit returns ready = true).
 *
 * O(1) — set lookup + at most three substring scans.
 */
export function isFatalPoolError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const codeCandidate = (error as { code?: unknown }).code;
  if (typeof codeCandidate === "string" && FATAL_POOL_SQLSTATES.has(codeCandidate)) {
    return true;
  }
  const messageCandidate = (error as { message?: unknown }).message;
  if (typeof messageCandidate !== "string" || messageCandidate.length === 0) {
    return false;
  }
  const lowered = messageCandidate.toLowerCase();
  for (let i = 0; i < FATAL_POOL_MESSAGE_NEEDLES.length; i++) {
    const needle = FATAL_POOL_MESSAGE_NEEDLES[i]!;
    if (lowered.includes(needle) && lowered.includes("does not exist")) {
      return true;
    }
    if (needle === "password authentication failed" && lowered.includes(needle)) {
      return true;
    }
  }
  return false;
}
