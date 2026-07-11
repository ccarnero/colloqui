// Retention cutoff math for the T03 (payload-capture) scrub job.
//
// Pure date arithmetic: `now - retentionDays days`. The retention interval
// lives in ONE place per the SPEC's user decision — the caller (the script
// entrypoint) resolves it from `PAYLOAD_RETENTION_DAYS` (default 30) and
// passes the resolved number in here. This module never reads env itself.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Returns the cutoff instant: rows with `occurred_at < cutoff` are eligible
 * for the scrub. `retentionDays` must be a positive integer — callers are
 * expected to have already validated it (see `resolve-retention-days.ts`).
 */
export function computeScrubCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * MS_PER_DAY);
}
