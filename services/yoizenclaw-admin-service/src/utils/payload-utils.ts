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

export function checkPayloadSize(
  payload: Record<string, unknown>,
  threshold = 262144,
): { inline: boolean; bytes: number; humanSize: string } {
  const bytes = new TextEncoder().encode(
    serializeCanonicalPayload(payload),
  ).byteLength;
  return {
    inline: bytes <= threshold,
    bytes,
    humanSize: formatBytes(bytes),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
