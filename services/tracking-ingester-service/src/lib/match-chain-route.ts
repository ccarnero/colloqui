// Pure route-matching helper for `GET /chains/:correlationId` (T02 of
// manual-loops/trace-console.md). Extracted from `src/main.ts` so the path
// pattern is unit-testable without a running `Bun.serve` instance — the
// code-style contract keeps main.ts I/O-only, so no DB/HTTP work happens
// here, just string parsing.

export interface ChainRouteMatch {
  readonly correlationId: string;
}

const CHAIN_ROUTE_PATTERN = /^\/chains\/([^/]+)\/?$/;

/**
 * Matches `pathname` against `/chains/:correlationId`. Returns `null` for any
 * non-matching path (including `/chains` with no id, or nested segments).
 * The captured id is URL-decoded so correlation ids containing encoded
 * characters (unlikely, but defensive) round-trip correctly.
 */
export function matchChainRoute(pathname: string): ChainRouteMatch | null {
  const match = CHAIN_ROUTE_PATTERN.exec(pathname);
  if (!match) {
    return null;
  }
  const rawId = match[1]!;
  const correlationId = decodeURIComponent(rawId);
  if (correlationId.length === 0) {
    return null;
  }
  return { correlationId };
}
