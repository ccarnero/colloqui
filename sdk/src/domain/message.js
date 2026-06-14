import { validateSender } from "./sender.js";
import { ValidationError } from "./errors.js";

/** Top-level fields the http channel understands as flat values. */
const KNOWN_FIELDS = new Set(["from", "text", "type", "messageId", "timestamp", "raw"]);

/**
 * Normalize an SDK message into the flat JSON body the http channel ingest endpoint
 * expects. Mirrors the platform's `InboundMessage`: only `from` is required; the rest
 * are optional/server-derived. `media` and any unrecognized top-level keys are folded
 * into `raw`; an explicitly supplied `raw` wins over folded extras on key collision.
 *
 * @param {Record<string, unknown>} input
 * @returns {Record<string, unknown>} flat ingest body
 * @throws {ValidationError}
 */
export function normalizeMessage(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError("message must be an object");
  }

  const body = { from: validateSender(input.from) };

  if (input.text !== undefined && typeof input.text !== "string") {
    throw new ValidationError("`text` must be a string when provided");
  }

  body.type =
    typeof input.type === "string" && input.type.length > 0 ? input.type : "text";

  if (input.text !== undefined) body.text = input.text;
  if (input.messageId !== undefined) body.messageId = String(input.messageId);
  if (input.timestamp !== undefined) body.timestamp = String(input.timestamp);

  const extras = {};
  for (const [key, value] of Object.entries(input)) {
    if (!KNOWN_FIELDS.has(key)) extras[key] = value;
  }
  const explicitRaw =
    input.raw !== null && typeof input.raw === "object" && !Array.isArray(input.raw)
      ? input.raw
      : undefined;

  const raw = { ...extras, ...(explicitRaw ?? {}) };
  if (Object.keys(raw).length > 0) body.raw = raw;

  return body;
}
