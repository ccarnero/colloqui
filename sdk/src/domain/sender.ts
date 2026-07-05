import { ValidationError } from "./errors.js";

/**
 * Validate and normalize a message sender identifier (the `from` field).
 * @throws {ValidationError}
 */
export function validateSender(from: unknown): string {
  if (typeof from !== "string") {
    throw new ValidationError("`from` must be a string", { details: { from } });
  }
  const trimmed = from.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("`from` must not be empty");
  }
  return trimmed;
}
