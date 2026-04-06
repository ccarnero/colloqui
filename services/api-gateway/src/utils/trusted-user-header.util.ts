export const YOIZEN_USER_ID_HEADER = "x-yoizen-user-id";

const HOP_BY_HOP_HEADERS = new Set([
  "host",
  "connection",
  "transfer-encoding",
]);

/**
 * Builds the header bag forwarded to upstream services.
 * Removes hop-by-hop headers and strips any client-supplied trusted user header.
 *
 * @param headers - Raw incoming request headers.
 * @param trustedUserId - Authenticated user subject from backend context.
 * @returns Forward-safe upstream headers.
 */
export function buildForwardHeaders(
  headers: Record<string, string | string[] | undefined>,
  trustedUserId?: string | null,
): Record<string, string> {
  const upstreamHeaders: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key.toLowerCase();

    if (
      HOP_BY_HOP_HEADERS.has(normalizedKey) ||
      normalizedKey === YOIZEN_USER_ID_HEADER
    ) {
      continue;
    }

    if (typeof value === "string") {
      upstreamHeaders[key] = value;
    }
  }

  setTrustedUserIdHeader(upstreamHeaders, trustedUserId);

  return upstreamHeaders;
}

/**
 * Applies the trusted backend user header only when a subject is available.
 *
 * @param headers - Upstream header bag to mutate.
 * @param trustedUserId - Authenticated user subject from JWT context.
 */
export function setTrustedUserIdHeader(
  headers: Record<string, string>,
  trustedUserId?: string | null,
): void {
  const normalizedUserId = trustedUserId?.trim();

  if (!normalizedUserId) {
    return;
  }

  headers[YOIZEN_USER_ID_HEADER] = normalizedUserId;
}
