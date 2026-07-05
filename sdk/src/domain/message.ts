import { ValidationError } from "./errors.js";
import { validateSender } from "./sender.js";

/** Top-level fields the http channel understands as flat values. */
const KNOWN_FIELDS = new Set([
  "from",
  "text",
  "type",
  "messageId",
  "timestamp",
  "raw",
]);

/**
 * Normalize an SDK message into the flat JSON body the http channel ingest endpoint
 * expects. Mirrors the platform's `InboundMessage`: only `from` is required; the rest
 * are optional/server-derived. `media` and any unrecognized top-level keys are folded
 * into `raw`; an explicitly supplied `raw` wins over folded extras on key collision.
 *
 * @returns flat ingest body
 * @throws {ValidationError}
 */
export function normalizeMessage(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError("message must be an object");
  }

  const record = input as Record<string, unknown>;
  const body: Record<string, unknown> = { from: validateSender(record.from) };

  if (record.text !== undefined && typeof record.text !== "string") {
    throw new ValidationError("`text` must be a string when provided");
  }

  body.type =
    typeof record.type === "string" && record.type.length > 0
      ? record.type
      : "text";

  if (record.text !== undefined) {
    body.text = record.text;
  }
  if (record.messageId !== undefined) {
    body.messageId = String(record.messageId);
  }
  if (record.timestamp !== undefined) {
    body.timestamp = String(record.timestamp);
  }

  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!KNOWN_FIELDS.has(key)) {
      extras[key] = value;
    }
  }
  const explicitRaw =
    record.raw !== null &&
    typeof record.raw === "object" &&
    !Array.isArray(record.raw)
      ? (record.raw as Record<string, unknown>)
      : undefined;

  const raw = { ...extras, ...(explicitRaw ?? {}) };
  if (Object.keys(raw).length > 0) {
    body.raw = raw;
  }

  return body;
}
