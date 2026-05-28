/**
 * Checks whether an error thrown by the MongoDB driver is a duplicate key
 * error (error code 11000). Works with both typed and untyped catch blocks.
 */
export function isMongoDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  if (code === 11000 || code === 11001) {
    return true;
  }
  const writeErrors = (error as { writeErrors?: unknown }).writeErrors;
  if (Array.isArray(writeErrors)) {
    for (let i = 0; i < writeErrors.length; i++) {
      const entry = writeErrors[i];
      if (
        typeof entry === "object" &&
        entry !== null &&
        (entry as { code?: unknown }).code === 11000
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Error codes / labels that mean the client pool is permanently broken for
 * the cached credentials or database target.
 */
const FATAL_MONGO_ERROR_CODES: ReadonlySet<number> = new Set([
  13, // Unauthorized
  18, // AuthenticationFailed
  8000, // AtlasError (auth)
]);

const FATAL_MONGO_MESSAGE_NEEDLES: readonly string[] = [
  "authentication failed",
  "auth failed",
  "not authorized",
  "ns not found",
  "topology is closed",
  "server selection timed out",
];

/**
 * Returns true when the given error indicates the Mongo client's underlying
 * database/credentials are no longer valid. Used by
 * {@link TenantMongoConnectionManager.verifyConnectivity} for self-healing.
 */
export function isFatalMongoError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === "number" && FATAL_MONGO_ERROR_CODES.has(code)) {
    return true;
  }
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string" || message.length === 0) {
    return false;
  }
  const lowered = message.toLowerCase();
  for (let i = 0; i < FATAL_MONGO_MESSAGE_NEEDLES.length; i++) {
    if (lowered.includes(FATAL_MONGO_MESSAGE_NEEDLES[i]!)) {
      return true;
    }
  }
  return false;
}
