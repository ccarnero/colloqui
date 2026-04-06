/**
 * Generates a cryptographically random UUID v4 identifier.
 * Replaces per-service `generateId` helpers.
 */
export function generateId(): string {
  return crypto.randomUUID();
}
