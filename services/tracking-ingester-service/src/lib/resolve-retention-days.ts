// Resolves `PAYLOAD_RETENTION_DAYS` (T03 of manual-loops/payload-capture.md).
//
// The retention interval lives in ONE place per the SPEC's user decision —
// this function IS that place. Every consumer of the retention window (the
// scrub script, and any future admin/debug tooling) must call this instead
// of re-parsing the env var or hardcoding `30`.
//
// Pure: reads a plain env bag, never `process.env` itself, never throws — a
// non-numeric/non-positive value falls back to the default (mirrors
// `readInt`'s convention in `load-config.ts`).

export const DEFAULT_PAYLOAD_RETENTION_DAYS = 30;

type EnvBag = Readonly<Record<string, string | undefined>>;

export function resolveRetentionDays(env: EnvBag): number {
  const raw = env.PAYLOAD_RETENTION_DAYS?.trim();
  if (!raw) {
    return DEFAULT_PAYLOAD_RETENTION_DAYS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_PAYLOAD_RETENTION_DAYS;
  }
  return parsed;
}
