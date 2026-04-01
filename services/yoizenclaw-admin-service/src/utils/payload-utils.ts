import { createHash } from "node:crypto";

function normalizePayloadValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizePayloadValue(item));
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([leftKey], [rightKey]) => leftKey.localeCompare(rightKey),
    );
    const normalized: Record<string, unknown> = {};

    for (const [key, entryValue] of entries) {
      normalized[key] = normalizePayloadValue(entryValue);
    }

    return normalized;
  }

  return value;
}

export function serializeCanonicalPayload(
  payload: Record<string, unknown>,
): string {
  return JSON.stringify(normalizePayloadValue(payload));
}

export function calculateChecksum(
  payload: Record<string, unknown>,
): string {
  const serialized = serializeCanonicalPayload(payload);
  const hash = createHash("sha256").update(serialized).digest("hex");
  return `sha256:${hash}`;
}

