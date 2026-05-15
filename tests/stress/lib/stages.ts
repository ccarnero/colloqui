/**
 * Phase 1 ramp profile (per stress-test-plan.md §1.3 / stress-test-adapted §1.5).
 *
 * Five stages plus a recovery spike. We model each stage as one
 * `ramping-arrival-rate` executor so k6 keeps a constant target rps regardless
 * of latency drift.
 *
 * All durations + rates are overridable via env so a smoke run can validate the
 * pipeline in <2 minutes without rewriting the file.
 *
 * Duration handling: k6 / Go's `time.ParseDuration` accepts "10m", "30s",
 * "1m30s", "500ms" — but NOT compound expressions like "10m+15m". This module
 * therefore parses every input duration into milliseconds (O(1) regex pass)
 * and re-emits the cumulative `startTime` for each stage as a single
 * compact Go-format string ("600s", "0s", ...).
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
  
  export interface ScenarioStartTimes {
    readonly baseline: string;
    readonly heavy: string;
    readonly light: string;
    readonly medium: string;
    readonly peak: string;
    readonly spike: string;
  }
  
  export function buildPhase1Stages(): {
    readonly stages: ReadonlyMap<string, StageDef>;
    readonly startTimes: ScenarioStartTimes;
    readonly totalDuration: string;
  } {
    const env = readEnv();
  
    const baselineDuration = envString(env, "STRESS_BASELINE_DURATION", "10m");
    const lightDuration = envString(env, "STRESS_LIGHT_DURATION", "15m");
    const mediumDuration = envString(env, "STRESS_MEDIUM_DURATION", "15m");
    const heavyDuration = envString(env, "STRESS_HEAVY_DURATION", "15m");
    const peakDuration = envString(env, "STRESS_PEAK_DURATION", "10m");
    const spikeRamp = envString(env, "STRESS_SPIKE_RAMP", "30s");
    const spikeHold = envString(env, "STRESS_SPIKE_HOLD", "1m30s");
  
    const baselineMs = parseDurationMs(baselineDuration);
    const lightMs = parseDurationMs(lightDuration);
    const mediumMs = parseDurationMs(mediumDuration);
    const heavyMs = parseDurationMs(heavyDuration);
    const peakMs = parseDurationMs(peakDuration);
    const spikeRampMs = parseDurationMs(spikeRamp);
    const spikeHoldMs = parseDurationMs(spikeHold);
  
    const baselineRate = envNumber(env, "STRESS_BASELINE_RATE", 10);
    const lightRate = envNumber(env, "STRESS_LIGHT_RATE", 50);
    const mediumRate = envNumber(env, "STRESS_MEDIUM_RATE", 200);
    const heavyRate = envNumber(env, "STRESS_HEAVY_RATE", 500);
    const peakRate = envNumber(env, "STRESS_PEAK_RATE", 1000);
    const spikePeakRate = envNumber(env, "STRESS_SPIKE_PEAK_RATE", 2000);
    const spikeRecoverRate = envNumber(env, "STRESS_SPIKE_RECOVER_RATE", 200);
  
    const baselineVUs = envNumber(env, "STRESS_BASELINE_VUS", 5);
    const lightVUs = envNumber(env, "STRESS_LIGHT_VUS", 25);
    const mediumVUs = envNumber(env, "STRESS_MEDIUM_VUS", 100);
    const heavyVUs = envNumber(env, "STRESS_HEAVY_VUS", 250);
    const peakVUs = envNumber(env, "STRESS_PEAK_VUS", 500);
    const spikeVUs = envNumber(env, "STRESS_SPIKE_VUS", 1000);
  
    const buildStage = (
      name: string,
      rate: number,
      durationMs: number,
      vus: number,
      purpose: string
    ): StageDef => {
      const duration = formatDurationMs(durationMs);
      return Object.freeze({
        duration,
        durationMs,
        name,
        preAllocatedVUs: vus,
        purpose,
        rate,
        stages: Object.freeze([{ duration, target: rate }]),
        startRate: rate,
      });
    };
  
    const baseline = buildStage(
      "baseline",
      baselineRate,
      baselineMs,
      baselineVUs,
      "Establish nominal latency, confirm zero loss"
    );
    const light = buildStage(
      "light",
      lightRate,
      lightMs,
      lightVUs,
      "Smooth steady-state"
    );
    const medium = buildStage(
      "medium",
      mediumRate,
      mediumMs,
      mediumVUs,
      "Typical busy-hour"
    );
    const heavy = buildStage("heavy", heavyRate, heavyMs, heavyVUs, "Stress");
    const peak = buildStage(
      "peak",
      peakRate,
      peakMs,
      peakVUs,
      "Breaking-point search"
    );
    const spikeRampStr = formatDurationMs(spikeRampMs);
    const spikeHoldStr = formatDurationMs(spikeHoldMs);
    const spike: StageDef = Object.freeze({
      duration: formatDurationMs(spikeRampMs + spikeHoldMs),
      durationMs: spikeRampMs + spikeHoldMs,
      name: "spike",
      preAllocatedVUs: spikeVUs,
      purpose: "Recovery / backpressure behaviour",
      rate: spikePeakRate,
      stages: Object.freeze([
        { duration: spikeRampStr, target: spikePeakRate },
        { duration: spikeHoldStr, target: spikeRecoverRate },
      ]),
      startRate: spikePeakRate,
    });
  
    const stages = new Map<string, StageDef>([
      [baseline.name, baseline],
      [light.name, light],
      [medium.name, medium],
      [heavy.name, heavy],
      [peak.name, peak],
      [spike.name, spike],
    ]);
  
    const baselineStartMs = 0;
    const lightStartMs = baselineStartMs + baseline.durationMs;
    const mediumStartMs = lightStartMs + light.durationMs;
    const heavyStartMs = mediumStartMs + medium.durationMs;
    const peakStartMs = heavyStartMs + heavy.durationMs;
    const spikeStartMs = peakStartMs + peak.durationMs;
    const totalMs = spikeStartMs + spike.durationMs;
  
    return {
      stages,
      startTimes: Object.freeze({
        baseline: formatDurationMs(baselineStartMs),
        heavy: formatDurationMs(heavyStartMs),
        light: formatDurationMs(lightStartMs),
        medium: formatDurationMs(mediumStartMs),
        peak: formatDurationMs(peakStartMs),
        spike: formatDurationMs(spikeStartMs),
      }),
      totalDuration: formatDurationMs(totalMs),
    };
  }
  