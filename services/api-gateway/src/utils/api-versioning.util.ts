/** Unversioned `/api/...` paths that are NOT deprecated aliases. */
export const VERSIONING_EXEMPT_PREFIXES = ["/api/docs"];
export const VERSIONED_API_PREFIX = "/api/v1/";
export const UNVERSIONED_API_PREFIX = "/api/";

/**
 * True for legacy `/api/...` requests that should be flagged as deprecated
 * (i.e. everything under `/api/` except the `/api/v1/...` routes themselves
 * and the Swagger docs paths, which were never versioned in the first place).
 */
export function isDeprecatedUnversionedApiPath(path: string): boolean {
  if (!path.startsWith(UNVERSIONED_API_PREFIX)) {
    return false;
  }
  if (path.startsWith(VERSIONED_API_PREFIX)) {
    return false;
  }
  return !VERSIONING_EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** Same path with `v1/` inserted right after the `/api/` prefix. */
export function toSuccessorVersionPath(path: string): string {
  return `${VERSIONED_API_PREFIX}${path.slice(UNVERSIONED_API_PREFIX.length)}`;
}
