/**
 * Phase 1 ramp profile (per stress-test-plan.md §1.3 / stress-test-adapted §1.5).
 *
 * Currently configured to run only the **medium** stage as one
 * `ramping-arrival-rate` executor so k6 keeps a constant target rps regardless
 * of latency drift.
 *
 * Duration and rate are overridable via env so a smoke run can validate the
 * pipeline in <2 minutes without rewriting the file.
 *
 * Duration handling: k6 / Go's `time.ParseDuration` accepts "10m", "30s",
 * "1m30s", "500ms" — but NOT compound expressions like "10m+15m". This module
 * therefore parses every input duration into milliseconds (O(1) regex pass)
 * and re-emits cumulative `startTime` values as single compact Go-format
 * strings ("600s", "0s", ...).
 */

export interface StageDef {
  readonly duration: string;
  readonly durationMs: number;
  readonly name: string;
  readonly preAllocatedVUs: number;
  readonly purpose: string;
  readonly rate: number;
  readonly stages: ReadonlyArray<{ duration: string; target: number }>;
  readonly startRate: number;
}

interface EnvBag {
  readonly [key: string]: string | undefined;
}

const DURATION_UNITS_MS: ReadonlyMap<string, number> = new Map([
  ["ms", 1],
  ["s", 1_000],
  ["m", 60_000],
  ["h", 3_600_000],
]);

const DURATION_TOKEN_REGEX = /(\d+(?:\.\d+)?)(ms|s|m|h)/gu;

function readEnv(): EnvBag {
  return (
    (globalThis as { __ENV?: Record<string, string | undefined> }).__ENV ?? {}
  );
}

function envNumber(env: EnvBag, key: string, fallback: number): number {
  const raw = env[key];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envString(env: EnvBag, key: string, fallback: string): string {
  return env[key] ?? fallback;
}

/**
 * Parse a Go-style duration string ("10m", "1m30s", "500ms") into milliseconds.
 *
 * Throws on malformed input so the failure surfaces at module init, not in the
 * middle of a long load run.
 */
export function parseDurationMs(value: string): number {
  if (!value || typeof value !== "string") {
    throw new Error(`Invalid duration: '${String(value)}'`);
  }
  const trimmed = value.trim();
  if (trimmed === "0" || trimmed === "0s") {
    return 0;
  }

  let total = 0;
  let consumed = 0;
  DURATION_TOKEN_REGEX.lastIndex = 0;
  let match = DURATION_TOKEN_REGEX.exec(trimmed);
  while (match !== null) {
    const [whole, magnitude, unit] = match;
    const factor = DURATION_UNITS_MS.get(unit ?? "");
    if (!factor || !magnitude) {
      throw new Error(`Unsupported duration unit in '${value}'.`);
    }
    total += Number(magnitude) * factor;
    consumed += whole.length;
    match = DURATION_TOKEN_REGEX.exec(trimmed);
  }

  if (consumed === 0 || consumed !== trimmed.length) {
    throw new Error(
      `Could not parse duration '${value}'. Use forms like '30s', '10m', '1m30s', '500ms'.`
    );
  }
  return total;
}

/**
 * Format a millisecond count into a single Go-format duration string accepted
 * by k6 (`time.ParseDuration`). Sub-second values use ms; everything else uses
 * whole seconds for readability.
 */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0s";
  }
  if (ms < 1_000 || ms % 1_000 !== 0) {
    return `${Math.round(ms)}ms`;
  }
  return `${Math.round(ms / 1_000)}s`;
}

export type ScenarioStartTimes = Readonly<Record<string, string>>;

export function buildPhase1Stages(): {
  readonly stages: ReadonlyMap<string, StageDef>;
  readonly startTimes: ScenarioStartTimes;
  readonly totalDuration: string;
} {
  const env = readEnv();

  const mediumDuration = envString(env, "STRESS_MEDIUM_DURATION", "15m");
  const mediumMs = parseDurationMs(mediumDuration);
  const mediumRate = envNumber(env, "STRESS_MEDIUM_RATE", 200);
  const mediumVUs = envNumber(env, "STRESS_MEDIUM_VUS", 100);

  const duration = formatDurationMs(mediumMs);
  const medium: StageDef = Object.freeze({
    duration,
    durationMs: mediumMs,
    name: "medium",
    preAllocatedVUs: mediumVUs,
    purpose: "Typical busy-hour",
    rate: mediumRate,
    stages: Object.freeze([{ duration, target: mediumRate }]),
    startRate: mediumRate,
  });

  const stages = new Map<string, StageDef>([[medium.name, medium]]);

  return {
    stages,
    startTimes: Object.freeze({ medium: "0s" }),
    totalDuration: duration,
  };
}
