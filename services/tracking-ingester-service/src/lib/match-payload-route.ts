// Pure route-matching helper for `GET /chains/:correlationId/events/:eventId/payload`
// (T04 of manual-loops/payload-capture.md). Mirrors match-chain-route.ts exactly —
// extracted from src/main.ts so the path pattern is unit-testable without a
// running `Bun.serve` instance. No DB/HTTP work happens here, just string parsing.

export interface PayloadRouteMatch {
  readonly correlationId: string;
  readonly eventId: string;
}

const PAYLOAD_ROUTE_PATTERN =
  /^\/chains\/([^/]+)\/events\/([^/]+)\/payload\/?$/;

/**
 * Matches `pathname` against `/chains/:correlationId/events/:eventId/payload`.
 * Returns `null` for any non-matching path. Both captured ids are URL-decoded
 * so ids containing encoded characters round-trip correctly.
 */
export function matchPayloadRoute(pathname: string): PayloadRouteMatch | null {
  const match = PAYLOAD_ROUTE_PATTERN.exec(pathname);
  if (!match) {
    return null;
  }
  const rawCorrelationId = match[1]!;
  const rawEventId = match[2]!;
  const correlationId = decodeURIComponent(rawCorrelationId);
  const eventId = decodeURIComponent(rawEventId);
  if (correlationId.length === 0 || eventId.length === 0) {
    return null;
  }
  return { correlationId, eventId };
}
