import type { FastifyRequest } from "fastify";

/**
 * Copies Fastify request headers suitable for upstream forwarding.
 * Only string header values are copied (multi-value arrays are skipped).
 *
 * @param req Incoming request
 * @param hopByHop Header names to exclude (lowercase)
 */
export function copyForwardableHeaders(
  req: FastifyRequest,
  hopByHop: ReadonlySet<string>,
): Record<string, string> {
  const upstreamHeaders: Record<string, string> = {};
  for (const [key, val] of Object.entries(req.headers)) {
    if (hopByHop.has(key)) continue;
    if (typeof val === "string") upstreamHeaders[key] = val;
  }
  return upstreamHeaders;
}
