import { createHash } from "node:crypto";

export function calculateChecksum(
  payload: Record<string, unknown>,
): string {
  const serialized = JSON.stringify(payload);
  return createHash("sha256").update(serialized).digest("hex");
}

export function checkPayloadSize(
  payload: Record<string, unknown>,
  threshold = 262144,
): { inline: boolean; bytes: number; humanSize: string } {
  const bytes = new TextEncoder().encode(
    JSON.stringify(payload),
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
